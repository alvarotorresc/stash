/**
 * Thrown only for invalid input from the caller (a URL that is not http/https, a payload of the
 * wrong type). Bad or unexpected data from the network never throws: it degrades instead.
 */
export class ReaderInputError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'ReaderInputError';
  }
}
