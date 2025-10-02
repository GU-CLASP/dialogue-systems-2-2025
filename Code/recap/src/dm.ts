import { assign, createActor, fromPromise, raise, setup } from "xstate";
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";

import type { DMEvents, DMContext, Message } from "./types";

import { KEY } from "./azure";

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
    //sst_speak: ({context}, params: { value: string }) => 
    //  context.spstRef.send({ type: "SPEAK", value: {utterance: params.value } }),
    // Note to self: I made the action definition tolerate string | undefined
    // (value: string is now value?: string) because of the mismatch:
    // typescript sees context.greeting as string | undefined (not just string), and 
    // in sst_speak it is defined as (params: { value: string })
    // Also I'm adding a fallback for the sake of saving time in the future!
    sst_speak: ({context}, params: { value?: string }) => 
      context.spstRef.send({ type: "SPEAK", value: {utterance: params.value ?? "Fallback in action" } }), //fallback
    
    //When user input is recognised --> append messages
    appendUserMessage: assign(({ context, event }) => {
      //console.log("appendUserMessage: " + event.value[0].utterance)
      return {
          messages: [...context.messages, 
            {
              role: "user",
              content: event.value[0].utterance
            }
          ],
        };
    }),

    // When LLM returns a response --> append messages
    appendAssistantMessage: assign(({ context, event }) => {
      //console.log("appendAssistantMessage: " + event.output.message.content)
      return {
        messages: [...context.messages, 
          {
            role: "assistant",
            content: event.output.message.content
          }
        ]
      };
    }),

  },

  actors: {
    //tutorial
    getModels: fromPromise <any, null>(() =>
      fetch("http://localhost:11434/api/tags").then((response) => 
        response.json()
      )  
    ),
    //tutorial
    tutorialActor: fromPromise <any, string> ((input) => {
      const body = {
        model: "llama3.1",
        stream: false,
        messages: [
          {
            role: "user",
            content: input.input,
          },
        ],
      };
      return fetch("http://localhost:11434/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
      }).then((response) => response.json());
    },
    ),
    
    //part 1
    chatbotActor: fromPromise<any, Message[]>((input) => {
      const body = {
        model: "llama3.1",
        stream: false,
        messages: input.input,
      };
      return fetch("http://localhost:11434/api/chat", {
        method: "POST",
        body : JSON.stringify(body),
      }).then((response) => response.json());
    }),

  },
  

}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    informationState: { latestMove: "ping" },
    lastResult: "",
    messages: [
      {
        role: "assistant",
        content: "You are a conversation assistant and your job is to provide very brief chat-like responses. You can break the ice with a friendly greeting.",
      }
    ],
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        //ASRTTS_READY: "GettingAvailableModels", //tutorial
        //ASRTTS_READY: "GeneratingGreeting", //tutorial
        ASRTTS_READY: "UpdatedGreeting", //part 1
      },
    },
    //tutorial
    GettingAvailableModels: {
      invoke: {
        src: "getModels",
        input: null,
        onDone: {
          target: "ProvidingAvailableModels",
          actions: assign(({ event }) => {
            return {
              ollamaModels: event.output.models.map((x: any) => x.name)
            };
          }),
        },
      },
    },
    //tutorial
    ProvidingAvailableModels: {
      entry: {
        type: "sst_speak",
        params: ({ context }) => ({
          value: `Hi there! The available models are the following: ${context.ollamaModels!.join(" ")}`,
          //value: `Hi there! The available models are the following`,
        }),
      },
      on: { SPEAK_COMPLETE: "GeneratingGreeting" },
    },
    //tutorial
    GeneratingGreeting: {
      invoke: {
        src: "tutorialActor",
        input: "Please, provide a short greeting",
        onDone: {
          target: "ProvidingGreeting",
          actions: assign(( {event} ) => {
            console.log("Message: " + event.output.message.content)
            return {
              greeting: event.output.message.content };
            }),
          },
        },
      },
    //tutorial
    ProvidingGreeting: {
      entry: {
        type: "sst_speak",
        params: ({ context }) => ({
          value: context.greeting,

        }),
      },
      on: {SPEAK_COMPLETE: "CompletionLoop"}
    },
    //part 1
    UpdatedGreeting: {
      invoke: {
        src: "chatbotActor",
        input: ({ context }) => context.messages,
        onDone: {
          target: "CompletionLoop",
          actions: assign({
            messages: ({ event, context }) => [
              ...context.messages, {
                role: "assistant",
                content: event.output.message.content
              }
            ],
          }),
        },
      },
    },
    //part 1
    CompletionLoop: {
      initial: "Speaking",
      states: {
        Speaking: {
          entry: ({ context }) =>
            context.spstRef.send({
              type: "SPEAK",
              value: { utterance: context.messages[context.messages.length -1].content},
            }),
          on: { SPEAK_COMPLETE: "Ask" }
        },
        Ask: {
          entry: "sst_listen",
          on: {
            LISTEN_COMPLETE: {
              target: "ChatCompletion",
            },
            RECOGNISED: {
              actions: "appendUserMessage",
            },
          },
        },
        ChatCompletion: {
          invoke: {
            src: "chatbotActor",
            input: ({ context }) => context.messages,
            onDone: {
              target: "Speaking",
              actions: "appendAssistantMessage",
            },
          },
        },
      },
    },

    /*
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
    },*/
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
