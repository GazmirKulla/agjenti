import OpenAI, { type ClientOptions } from "openai";
import { meteredFetch } from "./usage";

/** The only OpenAI client the app uses: identical to the SDK, plus per-business usage metering. */
export default class MeteredOpenAI extends OpenAI {
  constructor(options?: ClientOptions) {
    super({ ...options, fetch: meteredFetch(options?.fetch ?? fetch) });
  }
}
