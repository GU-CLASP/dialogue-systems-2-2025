import { assign, createActor, raise, setup } from "xstate";
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";

import type { DMEvents, DMContext, Message } from "./types";

import { KEY } from "./azure.ts";

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

const dmMachine = setup({
  types: {
    /** you might need to extend these */
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    sst_prepare: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
    sst_listen: ({ context }) => context.spstRef.send({ type: "LISTEN" }),
  },
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    informationState: { latestMove: "ping" },
    lastResult: "",
    messages: [],
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "Main",
      },
    },
    Main: {
      type: "parallel",
      states: {
        Interpret: {
          initial: "Idle",
          states: {
            Idle: {
              on: { SPEAK_COMPLETE: "Recognising" },
            },
            Recognising: {
              entry: "sst_listen",
              on: {
                LISTEN_COMPLETE: {
                  target: "Idle",
                  actions: raise(({ context }) => ({
                    type: "SAYS",
                    value: context.lastResult,
                  })),
                },
                RECOGNISED: {
                  actions: assign(({ event }) => ({
                    lastResult: event.value[0].utterance,
                  })),
                },
              },
            },
          },
        },
        Generate: {
          initial: "Idle",
          states: {
            Speaking: {
              entry: ({ context, event }) =>
                context.spstRef.send({
                  type: "SPEAK",
                  value: { utterance: (event as any).value },
                }),
              on: { SPEAK_COMPLETE: "Idle" },
            },
            Idle: {
              on: { NEXT_MOVE: "Speaking" },
            },
          },
        },
        Process: {
          initial: "Select",
          states: {
            Select: {
              always: {
                guard: ({ context }) =>
                  context.informationState.latestMove !== "",
                actions: raise(({ context }) => ({
                  type: "NEXT_MOVE",
                  value: context.informationState.latestMove,
                })),
                target: "Update",
              },
            },
            Update: {
              entry: assign({ informationState: { latestMove: "" } }),
              on: {
                SAYS: {
                  target: "Select",
                  actions: assign(({ event }) => ({
                    informationState: { latestMove: event.value },
                  })),
                },
              },
            },
          },
        },
      },
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta()
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}
