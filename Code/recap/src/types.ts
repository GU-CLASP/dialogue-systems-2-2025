import type { SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";

export type Message = {
  role: "assistant" | "user" | "system";
  content: string;
}

export interface DMContext {
  spstRef: AnyActorRef;
  ollamaModels?: string[];
  message?: string;
  messages: Message[];
}

export type DMEvents =
  | SpeechStateExternalEvent
  | { type: "CLICK" }
  | { type: "SAYS"; value: string }
  | { type: "NEXT_MOVE"; value: string }
  | { type: "DONE" };
