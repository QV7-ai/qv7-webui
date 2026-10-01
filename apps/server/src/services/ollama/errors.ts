export class OllamaError extends Error {
  constructor(
    public code:
      | "OLLAMA_UNAVAILABLE"
      | "MODEL_NOT_FOUND"
      | "MODEL_LOAD_FAILED"
      | "REQUEST_ABORTED"
      | "INVALID_REQUEST"
      | "TIMEOUT"
      | "UNKNOWN",
    message: string,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export function publicErrorMessage(code: OllamaError["code"]) {
  switch (code) {
    case "OLLAMA_UNAVAILABLE":
      return "Unable to reach the AI model. Check that Ollama is running and try again.";
    case "MODEL_NOT_FOUND":
      return "The selected model could not be found.";
    case "MODEL_LOAD_FAILED":
      return "The model could not be loaded.";
    case "REQUEST_ABORTED":
      return "Generation was interrupted.";
    case "TIMEOUT":
      return "The request timed out.";
    case "INVALID_REQUEST":
      return "The request was invalid.";
    default:
      return "Something went wrong while generating the response.";
  }
}
