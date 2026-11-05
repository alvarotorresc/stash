/**
 * Entry point of the dedicated Argon2id worker. The logic lives in `password-keys.ts` and is
 * unit-tested there; this file only wires the message port.
 */
import { handlePasswordKeyRequest, type PasswordKeyRequest } from './password-keys';

interface WorkerScope {
  onmessage: ((event: MessageEvent<PasswordKeyRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = ({ data }) => {
  void handlePasswordKeyRequest(data).then((response) => scope.postMessage(response));
};
