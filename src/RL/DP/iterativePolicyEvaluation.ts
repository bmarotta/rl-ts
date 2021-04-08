import { Agent } from '../Agent';
import { Environment } from '../Environments';
import { Space } from '../Spaces';

//TODO: Handle stochastic environments
export class IterativePolicyEvaluation<
  ActionSpace extends Space<Action>,
  ObservationSpace extends Space<State>,
  Action,
  State
> extends Agent<State, Action> {
  public env: Environment<ActionSpace, ObservationSpace, Action, State, number>;
  public valueFunction: Map<any, number> = new Map();
  public valueActionFunction: Map<any, { value: number; action: Action }> = new Map();
  constructor(
    env: Environment<ActionSpace, ObservationSpace, Action, State, number>,
    public envToStateRep: (envToConvert: typeof env) => any,
    public envFromStateRep: (stateString: any) => typeof env,
    public allStateReps: any[],
    public policy: (action: Action, observation: State) => number,
    public dynamics: (sucessorState: State, reward: number, state: State, action: Action) => number,
    public allPossibleActions: Action[]
  ) {
    super();
    this.env = env;
    allStateReps.forEach((s) => {
      this.valueFunction.set(s, 0);
    });
  }
  train(steps: number, verbose = false): void {
    for (let step = 1; step <= steps; step++) {
      let updated_values = new Map();
      if (verbose) {
        console.log(`Step ${verbose}`);
      }
      for (let stateString of this.allStateReps) {
        let val = 0;
        let s = this.envFromStateRep(stateString);
        let v_pi_s = 0;
        for (let action of this.allPossibleActions) {
          let observation = s.reset();
          let stepOut = s.step(action);
          let p_srsa = this.policy(action, observation);
          let reward = stepOut.reward;
          let done = stepOut.done;

          let sp_stateString = this.envToStateRep(s);

          let v_pi_sp = this.valueFunction.get(sp_stateString)!;
          let p_sp_s_r = this.dynamics(stepOut.observation, reward, observation, action);
          v_pi_s += p_srsa * p_sp_s_r * (reward + 1 * v_pi_sp);
        }

        updated_values.set(stateString, v_pi_s);
      }
      updated_values.forEach((v, k) => {
        this.valueFunction.set(k, v);
      });
    }
  }
  action(observation: State): Action {
    let hash = this.hashState(observation);
    let choice = this.valueActionFunction.get(hash);
    if (!choice) return this.env.actionSpace.sample();
    return choice.action;
  }
  private hashState(observation: State): string {
    return JSON.stringify(this.env.observationSpace.to_jsonable([observation])[0]);
  }
}