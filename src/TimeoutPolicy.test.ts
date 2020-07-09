import { expect } from 'chai';
import { promisify } from 'util';
import { CancellationTokenSource } from './CancellationToken';
import { defer } from './common/defer';
import { runInChild } from './common/util.test';
import { TaskCancelledError } from './errors/TaskCancelledError';
import { Policy } from './Policy';
import { TimeoutStrategy } from './TimeoutPolicy';

const delay = promisify(setTimeout);

describe('TimeoutPolicy', () => {
  it('works when no timeout happens', async () => {
    const policy = Policy.timeout(1000, TimeoutStrategy.Cooperative);
    expect(await policy.execute(() => 42)).to.equal(42);
  });

  it('properly cooperatively cancels', async () => {
    const policy = Policy.timeout(2, TimeoutStrategy.Cooperative);
    expect(
      await policy.execute(async ({ cancellation }) => {
        expect(cancellation.isCancellationRequested).to.be.false;
        await delay(3);
        expect(cancellation.isCancellationRequested).to.be.true;
        return 42;
      }),
    ).to.equal(42);
  });

  it('properly aggressively cancels', async () => {
    const policy = Policy.timeout(5, TimeoutStrategy.Aggressive);
    const verified = defer();
    await expect(
      policy.execute(async ({ cancellation }) => {
        await delay(0);
        expect(cancellation.isCancellationRequested).to.be.false;
        await delay(5);
        expect(cancellation.isCancellationRequested).to.be.true;
        verified.resolve(undefined);
        return 42;
      }),
    ).to.eventually.be.rejectedWith(TaskCancelledError);

    await verified.promise;
  });

  it('does not unref by default', async () => {
    // this would timeout if the timers were referenced
    const output = await runInChild(`
      Policy.timeout(100, 'aggressive')
        .execute(() => new Promise(() => {}));
    `);

    expect(output).to.contain('Operation cancelled');
  });

  it('unrefs as requested', async () => {
    // this would timeout if the timers were referenced
    const output = await runInChild(`
      Policy.timeout(60 * 1000, 'aggressive')
        .dangerouslyUnref()
        .execute(() => new Promise(() => {}));
    `);

    expect(output).to.be.empty;
  });

  it('links parent cancellation token', async () => {
    const parent = new CancellationTokenSource();
    await Policy.timeout(1000, TimeoutStrategy.Cooperative).execute((_, ct) => {
      expect(ct.isCancellationRequested).to.be.false;
      parent.cancel();
      expect(ct.isCancellationRequested).to.be.true;
    }, parent.token);
  });

  it('still has own timeout if given parent', async () => {
    const parent = new CancellationTokenSource();
    await Policy.timeout(1, TimeoutStrategy.Cooperative).execute(async (_, ct) => {
      expect(ct.isCancellationRequested).to.be.false;
      await delay(3);
      expect(ct.isCancellationRequested).to.be.true;
    }, parent.token);
  });
});
