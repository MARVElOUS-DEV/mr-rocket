export type ServiceChainNext = () => Promise<void>;

export type ServiceChainStep<TContext> = (
  context: TContext,
  next: ServiceChainNext
) => Promise<void> | void;

export class ServiceChain<TContext> {
  private readonly steps: ServiceChainStep<TContext>[] = [];

  use(step: ServiceChainStep<TContext>): this {
    this.steps.push(step);
    return this;
  }

  async run(context: TContext): Promise<TContext> {
    let index = -1;
    const dispatch = async (stepIndex: number): Promise<void> => {
      if (stepIndex <= index) {
        throw new Error("next() called multiple times");
      }
      index = stepIndex;
      const step = this.steps[stepIndex];
      if (!step) {
        return;
      }
      await step(context, () => dispatch(stepIndex + 1));
    };

    await dispatch(0);
    return context;
  }
}
