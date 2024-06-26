import * as tf from '@tensorflow/tfjs';
import { SymbolicTensor } from '@tensorflow/tfjs';
import { ActivationIdentifier } from '@tensorflow/tfjs-layers/dist/keras_format/activation_config';
import { Box, Discrete, Shape, Space } from 'rl-ts/lib/Spaces';
import { Distribution } from 'rl-ts/lib/utils/Distributions';
import { Normal } from 'rl-ts/lib/utils/Distributions/normal';
import { Categorical } from '../utils/Distributions/categorical';

let global_gaussian_actor_log_std_id = 0;

/** Create a MLP model */
export const createMLP = (
  in_shape: Shape,
  out_dim: number,
  hidden_sizes: number[],
  activation: ActivationIdentifier,
  name?: string
) => {
  const input = tf.input({ shape: in_shape });
  let layer: tf.SymbolicTensor | tf.SymbolicTensor[] | tf.Tensor | tf.Tensor[];
  if (in_shape.length === 1) {
    layer = tf.layers.dense({ units: hidden_sizes[0], activation }).apply(input);
  } else {
    layer = tf.layers.flatten().apply(input);
    layer = tf.layers.dense({ units: hidden_sizes[0], activation }).apply(layer);
  }
  for (const size of hidden_sizes.slice(1)) {
    layer = tf.layers.dense({ units: size, activation }).apply(layer);
  }
  layer = tf.layers.dense({ units: out_dim, activation: 'linear' }).apply(layer);
  return tf.model({ inputs: input, outputs: layer as SymbolicTensor, name });
};

export abstract class Actor<Observation extends tf.Tensor> {
  abstract _distribution(obs: Observation): Distribution;
  abstract _log_prob_from_distribution(pi: Distribution, act: tf.Tensor): tf.Tensor;
  abstract apply(obs: Observation, act: tf.Tensor): { pi: Distribution; logp_a: tf.Tensor | null };
}
export abstract class Critic<Observation extends tf.Tensor> {
  abstract apply(obs: Observation): tf.Tensor;
}
export abstract class ActorCritic<Observation extends tf.Tensor> {
  abstract pi: Actor<Observation>;
  abstract v: Critic<Observation>;
  abstract step(
    obs: Observation
  ): {
    a: tf.Tensor;
    logp_a: tf.Tensor | null;
    v: tf.Tensor;
  };
  abstract act(obs: Observation): tf.Tensor;
}

export abstract class ActorBase<Observation extends tf.Tensor> extends Actor<Observation> {
  apply(obs: Observation, act: tf.Tensor | null) {
    const pi = this._distribution(obs);
    let logp_a = null;
    if (act !== null) {
      logp_a = this._log_prob_from_distribution(pi, act);
    }
    return {
      pi,
      logp_a,
    };
  }
}

export class MLPGaussianActor extends ActorBase<tf.Tensor> {
  public mu_net: tf.LayersModel;
  public log_std: tf.Variable;
  public mu: tf.Variable;
  constructor(obs_shape: Shape, public act_dim: number, hidden_sizes: number[], activation: ActivationIdentifier) {
    super();
    this.log_std = tf.variable(
      tf.ones([act_dim], 'float32').mul(-0.5),
      true,
      `gaussian_actor_log_std_${global_gaussian_actor_log_std_id++}`
    );
    this.mu_net = createMLP(obs_shape, act_dim, hidden_sizes, activation, 'MLP Gaussian Actor');
    this.mu = tf.variable(tf.tensor(0));
  }
  _distribution(obs: tf.Tensor) {
    const mu = this.mu_net.apply(obs) as tf.Tensor; // [B, act_dim]
    const batch_size = mu.shape[0];
    const std = tf.exp(this.log_std).expandDims(0).tile([batch_size, 1]); // from [act_dim] shaped to [B, act_dim]
    return new Normal(mu, std);
  }
  _log_prob_from_distribution(pi: Normal, act: tf.Tensor): tf.Tensor {
    return pi.logProb(act).sum(-1);
  }
}

export class MLPCategoricalActor extends ActorBase<tf.Tensor> {
  public logits_net: tf.LayersModel;
  constructor(obs_shape: Shape, act_dim: number, hidden_sizes: number[], activation: ActivationIdentifier) {
    super();
    this.logits_net = createMLP(obs_shape, act_dim, hidden_sizes, activation);
  }
  _distribution(obs: tf.Tensor): Distribution {
    const logits = this.logits_net.apply(obs) as tf.Tensor;
    return new Categorical(logits);
  }
  _log_prob_from_distribution(pi: Distribution, act: tf.Tensor<tf.Rank>): tf.Tensor<tf.Rank> {
    const prob = pi.logProb(act);
    return prob;
  }
}

export class MLPCritic extends Critic<tf.Tensor> {
  public v_net: tf.LayersModel;
  constructor(obs_shape: Shape, hidden_sizes: number[], activation: ActivationIdentifier) {
    super();
    this.v_net = createMLP(obs_shape, 1, hidden_sizes, activation, 'MLP Critic');
  }
  apply(obs: tf.Tensor) {
    // TODO check need squeeze?
    return this.v_net.apply(obs) as tf.Tensor;
  }
}

export class MLPActorCritic extends ActorCritic<tf.Tensor> {
  public pi: Actor<tf.Tensor>;
  public v: Critic<tf.Tensor>;
  constructor(
    public observationSpace: Space<any>,
    public actionSpace: Space<any>,
    hidden_sizes: number[],
    activation: ActivationIdentifier = 'tanh'
  ) {
    super();
    const obs_shape = observationSpace.shape;
    const act_dim = actionSpace.shape[0];
    if (actionSpace instanceof Box) {
      this.pi = new MLPGaussianActor(obs_shape, act_dim, hidden_sizes, activation);
    } else if (actionSpace instanceof Discrete) {
      this.pi = new MLPCategoricalActor(obs_shape, act_dim, hidden_sizes, activation);
    } else {
      throw new Error('This action space is not supported');
    }
    this.v = new MLPCritic(obs_shape, hidden_sizes, activation);
  }
  step(obs: tf.Tensor) {
    const pi = this.pi._distribution(obs);
    const a = pi.sample();
    const logp_a = this.pi._log_prob_from_distribution(pi, a);
    const v = this.v.apply(obs);
    return {
      a,
      logp_a,
      v,
    };
  }
  act(obs: tf.Tensor) {
    return this.step(obs).a;
  }
}
