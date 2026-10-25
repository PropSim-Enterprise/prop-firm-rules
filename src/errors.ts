/** Thrown when the input, a rule or a helper argument is invalid. The message names the field. */
export class InvalidInputError extends Error {
  override readonly name = "InvalidInputError";
}
