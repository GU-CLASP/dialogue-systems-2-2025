import { assign, createActor, fromPromise, setup } from "xstate";
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
    sst_prepare: ({ context }) => {
      console.log("sending prepare to speechstate");
      context.spstRef.send({ type: "PREPARE" });
    },
    sst_listen: ({ context }) => {
      console.log("sending listen to speechstate");
      context.spstRef.send({ type: "LISTEN" });
    },
  },
  actors: {
    Models: fromPromise<any, null>(() =>
      fetch("http://localhost:11435/api/tags").then(r => r.json())
    ),
    ModelsReply: fromPromise<any, Message[]>(({ input }) => {
      const body = { 
        model: "llama3.2", 
        stream: false,
        messages: input 
      };
      return fetch("http://localhost:11435/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      }).then(r => r.json());
    })
  }
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    informationState: { latestMove: "ping" },
    lastResult: "",
    messages: [],
    ollamaModels: []
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: { ASRTTS_READY: "Models" },
    },
    Models: {
      invoke: {
        src: "Models",
        input: null,
        onDone: {
          target: "Loop",
          actions: assign(({ event }) => ({
            ollamaModels: event.output.models.map((x: any) => x.name)
          }))
        }
      }
    },
    Loop: {
      initial: "Idle",
      states: {
        Idle: {
          entry: assign(({ context }) => ({
            messages: [
              { role: "assistant", content: "You are a helpful assistant. Provide brief chat-like answers. Start with a greeting."},
              { role: "user", content: "Say hello to start a conversation." },
              ...context.messages
            ]
          })),
          always: { target: "ChatCompletion" }
        },
        Speaking: {
          entry: ({ context }) => {
            const utterance = context.messages[0].content;
            console.log("speak:", utterance);
            context.spstRef.send({
              type: "SPEAK",
              value: { utterance },
            });
          },
          on: { SPEAK_COMPLETE: "Ask" }
        },
        Ask: {
          entry: "sst_listen",
          on: {
            RECOGNISED: {
              actions: assign(({ context, event }) => {
                const utterance = event.value?.[0]?.utterance ?? "";
                console.log("asr recognised:", utterance );
                return {
                  messages: [
                    { role: "user", content: utterance },
                    ...context.messages,
                  ],
                };
              }),
              target: "ChatCompletion",
            },
            ASR_NOINPUT: {
              actions: assign(({ context }) => {
                console.log("ASR noinput");
                return {
                  messages: [
                    { role: "assistant", content: "I can't hear you." }, 
                    ...context.messages,
                  ],
                };
              }),
            },
          },
        },
        ChatCompletion: {
          invoke: {
            src: "ModelsReply",
            input: (context) => context.context.messages,
            onDone: {
              target: "Speaking",
              actions: assign(({ event, context }) => {
                const reply = event.output.message?.content?.trim();
                console.log("LLM reply:", reply);
                return {
                  messages: [
                    { role: "assistant", content: reply && reply.length > 0 ? reply : "Hello! How are you today?" },
                    ...context.messages
                  ],
                };
              }),
            },
          },
        },
      },
    },
  },
});
//     Main: {
//       type: "parallel",
//       states: {
//         Interpret: {
//           initial: "Idle",
//           states: {
//             Idle: {
//               on: { SPEAK_COMPLETE: "Recognising" },
//             },
//             Recognising: {
//               entry: "sst_listen",
//               on: {
//                 LISTEN_COMPLETE: {
//                   target: "Idle",
//                   actions: raise(({ context }) => ({
//                     type: "SAYS",
//                     value: context.lastResult,
//                   })),
//                 },
//                 RECOGNISED: {
//                   actions: assign(({ event }) => ({
//                     lastResult: event.value[0].utterance,
//                   })),
//                 },
//               },
//             },
//           },
//         },
//         Generate: {
//           initial: "Idle",
//           states: {
//             Speaking: {
//               entry: ({ context, event }) =>
//                 context.spstRef.send({
//                   type: "SPEAK",
//                   value: { utterance: (event as any).value },
//                 }),
//               on: { SPEAK_COMPLETE: "Idle" },
//             },
//             Idle: {
//               on: { NEXT_MOVE: "Speaking" },
//             },
//           },
//         },
//         Process: {
//           initial: "Select",
//           states: {
//             Select: {
//               always: {
//                 guard: ({ context }) =>
//                   context.informationState.latestMove !== "",
//                 actions: raise(({ context }) => ({
//                   type: "NEXT_MOVE",
//                   value: context.informationState.latestMove,
//                 })),
//                 target: "Update",
//               },
//             },
//             Update: {
//               entry: assign({ informationState: { latestMove: "" } }),
//               on: {
//                 SAYS: {
//                   target: "Select",
//                   actions: assign(({ event }) => ({
//                     informationState: { latestMove: event.value },
//                   })),
//                 },
//               },
//             },
//           },
//         },
//       },
//     },
//   },
// });

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((snapshot) => {
  console.group("State update");
  console.log("State value:", snapshot.value);
  console.log("State context:", snapshot.context);
  console.groupEnd();

  if (snapshot.context.spstRef && !snapshot.context.spstRef._debugAttached) {
    snapshot.context.spstRef._debugAttached = true;
    snapshot.context.spstRef.subscribe((s) => {
      console.group("speechstate update");
      console.log("speechstate state:", s.value);
      console.log("speechstate event:", s.event);
      console.log("speechstate contect:", s.context);
      console.groupEnd();
    });
  }
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
