import { assign, createActor, setup, fromPromise } from "xstate";
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
    sst_speak: ({ context }, params: { utterance: string }) => 
      context.spstRef.send({type: "SPEAK", value: {utterance: params.utterance},
      }),
  },
  actors: {
    getModels: fromPromise<any, null>( () =>
      fetch("http://localhost:11434/api/tags").then((response) => response.json()
      ),
    ),
    getGreeting: fromPromise<any, string>( (input) => 
      { 
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
      }).then(response => response.json());
    }
    ),
    getChatCompletion: fromPromise<any, Message[]>( (input) =>
      { 
        const body = {
          model: "llama3.1",
          stream: false,
          messages: input.input,
          //temperature: 0,
          //seed: 9,
        };
        return fetch("http://localhost:11434/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      }).then(response => response.json());
    }
    )
  },
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    messages: [
      { role: "system", content: "You are a helpful assistant. Provide very brief chat-like responses!"},
      { role: "user", content: "Say some very short greeting to start the conversation!"}
      //{ role: "user", content: "Tell me a story about a dragon and a baker"}
    ]
  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "GetGreeting",
      },
    },
    GetModels: {
      invoke: {
        src: "getModels",
        input: null,
        onDone: {
          target: "Prompt",
          actions: assign(({event}) => {
            return { ollamaModels: event.output.models.map((x: any) => x.name) }
          }
          ),
        },
      },
    },
    Prompt: {
      entry: ({ context}) =>
                context.spstRef.send({
                  type: "SPEAK",
                  value: { utterance: `Hello! The models are ${context.ollamaModels?.join(", ")}` },
                }),
      on: { SPEAK_COMPLETE: "Loop" },
    },
    GetGreeting: {
      invoke: {
        src: "getChatCompletion",
        input: ({ context }) => context.messages,
        onDone: {
          target: "Loop",
          actions: assign ({
                messages: ({ event, context }) => [
                ...context.messages,
                {role: "assistant", content: event.output.message.content}
                ],
              }),
        },
      },
    },
    Greeting: {
      entry: ({ context}) =>
                context.spstRef.send({
                  type: "SPEAK",
                  value: { utterance: context.message },
                }),
      on: { SPEAK_COMPLETE: "Loop" },
    },
    GetChatCompletion: {
      invoke: {
        src: "getChatCompletion",
        input: ({ context }) => context.messages,
        onDone: {
          //target: "Greeting",
          actions: ({ event }) => 
            console.log(event.output)
          
        },
      },
    },
    Loop: {
      initial: "Speaking",
      states: {
        Speaking: {
          entry: ({ context}) =>
                context.spstRef.send({
                  type: "SPEAK",
                  value: { utterance: context.messages[context.messages.length -1].content},
                }),
          on: { SPEAK_COMPLETE: "Asking" },
        },
        Asking: {
          entry: "sst_listen",
          on: {
            LISTEN_COMPLETE: {
              target: "ChatCompletion",
            },
            RECOGNISED: {
              actions: assign ({
                messages: ({ event, context }) => [
                ...context.messages,
                {role: "user", content: event.value[0].utterance}
                ],
              }),
            },
            ASR_NOINPUT: {
              actions: assign ({
                messages: ({ context }) => [
                ...context.messages,
                {role: "user", content: "Can you kindly repeat or summarize your last turn or change the topic of conversation if that seems appropriate?"}
                //{role: "system", content: "if the user does not respond, kindly repeat or summarize your last turn or change topic to keep the conversation going. Always say something to encourage the user to respond."}
                ],
              }),
            },
          }
        },
        ChatCompletion: {
          invoke: {
            src: "getChatCompletion",
            input: ({ context }) => context.messages,
            onDone: {
              target: "Speaking",
              actions: assign ({
                messages: ({ event, context }) => [
                ...context.messages,
                {role: "assistant", content: event.output.message.content}
                ],
              }),
            },
          },
        }
      }
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
