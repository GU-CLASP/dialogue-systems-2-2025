import type { SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";

// NEW: Message interface
export interface Message {
  role: "assistant" | "user" | "system";
  content: string;
}

export interface DMContext {
  spstRef: AnyActorRef;
  lastResult: string;
  informationState: { latestMove: string };
  messages: Message[];
  temperature?: number;  // <-- add this
  currentModel?: string; // <-- add this
  noinputCounter?: number; // <-- add this
}

export type DMEvents =
  | SpeechStateExternalEvent
  | { type: "CLICK" }
  | { type: "SAYS"; value: string }
  | { type: "NEXT_MOVE"; value: string }
  | { type: "DONE" }
  | { type: "INCREASE_TEMPERATURE" }  // <-- add these
  | { type: "DECREASE_TEMPERATURE" }  // <-- add these
  | { type: "SET_TEMPERATURE"; temperature: number }  // <-- add these
  | { type: "CHANGE_MODEL"; model: string }  // <-- add these
  | { type: "INCREASE_TOP_K" }        // Add these
  | { type: "DECREASE_TOP_K" }        // Add these
  | { type: "SET_TOP_K"; top_k: number }; // Add these
  
  
  // import type { SpeechStateExternalEvent } from "speechstate";
// import type { AnyActorRef } from "xstate";

// // NEW: Message interface
// export interface Message {
//   role: "assistant" | "user" | "system";
//   content: string;
// }

// export interface DMContext {
//   spstRef: AnyActorRef;
//   lastResult: string;
//   // nextUtterance: string;
//   informationState: { latestMove: string };
//   messages: Message[];  // <-- new
// }

// export type DMEvents =
//   | SpeechStateExternalEvent
//   | { type: "CLICK" }
//   | { type: "SAYS"; value: string }
//   | { type: "NEXT_MOVE"; value: string }
//   | { type: "DONE" };
