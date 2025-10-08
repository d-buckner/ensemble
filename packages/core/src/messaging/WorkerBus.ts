import { pack } from 'msgpackr';
import { ThreadBus } from './ThreadBus';


export default class WorkerBus extends ThreadBus {
  protected post(actorId: string, eventName: string, payload: unknown): void {
    self.postMessage(pack({
      actorId,
      eventName,
      payload,
    }));
  }
}
