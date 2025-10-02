import { assign, createActor, raise, setup } from "xstate";
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";

import { fromPromise } from "xstate/actors";

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
  asrDefaultNoInputTimeout: 3000, // Reduced for faster testing
  locale: "en-US",
  ttsDefaultVoice: "en-US-DavisNeural",
};

interface MyDMContext extends DMContext {
  noinputCounter: number;
  ollamaModels?: string[];
  temperature: number; // Added temperature control
  currentModel: string; // Added model selection
  top_k: number;  // Add top_k to context
}

interface DMContext {
  count: number;
  spstRef: AnyActorRef;
  informationState: { latestMove: string };
  lastResult: string;
  messages: Message[];
}

// Updated fetchLLM function with temperature and model parameters
async function fetchLLM(
  messages: Message[], 
  model: string = "llama3.1", 
  temperature: number = 0.7,
  top_k: number = 100 // Add top_k parameter
): Promise<string> {
  try {
    console.log(`Calling LLM with model: ${model}, temperature: ${temperature}, top_k: ${top_k}`);

    const body = {
      model: model,
      stream: false,
      messages: messages,
      options: {
        temperature: temperature,
        top_p: 0.9,
        top_k: top_k,  // Use the top_k parameter
        // PARAMETERS
        num_ctx: 4096,      // Context window size
        num_predict: 128,   // Max tokens to predict
        repeat_penalty: 1.1, // Penalize repetition
        seed: 42,           // For reproducible results
        stop: ["\n", "user:"], // Stop sequences
        num_gpu: 1,         // GPU layers (if available)
        main_gpu: 0,        // Main GPU
        low_vram: false,    // Low VRAM mode
        f16_kv: true,       // Use fp16 for KV cache
        vocab_only: false,  // Only load vocabulary
        use_mmap: true,     // Use memory mapping
        use_mlock: false,   // Lock memory
      }
    };

    console.log("Request body:", JSON.stringify(body, null, 2));
    
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("HTTP error details:", errorText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // According to Ollama API docs, for non-streaming we get a single JSON object
    const data = await response.json();
    console.log("Full API response:", data);

    // Check the response structure according to Ollama API
    if (data.message && data.message.content) {
      const reply = data.message.content.trim();
      console.log("Extracted LLM reply:", reply);
      return reply;
    } else {
      console.error("Unexpected response format - no message.content found:", data);
      throw new Error("Invalid response format from LLM API");
    }

  } catch (error) {
    console.error("fetchLLM failed:", error);
    
    // More specific error messages based on common issues
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return "I cannot connect to the AI service. Please make sure Ollama is running with 'ollama serve'.";
    }
    
    if (error instanceof Error && error.message.includes('model not found')) {
      return `The AI model '${model}' is not available. Please install it with 'ollama pull ${model}'.`;
    }
    
    return "I apologize, but I'm having trouble processing your request right now. Please try again.";
  }
}

// TEMPERATURE FUNCTIONS

// Function to increase temperature
function increaseTemp() {
  dmActor.send({ type: "INCREASE_TEMPERATURE" });
  console.log("Temperature increased to:", getCurrentTemperature());
}

// Function to decrease temperature  
function decreaseTemp() {
  dmActor.send({ type: "DECREASE_TEMPERATURE" });
  console.log("Temperature decreased to:", getCurrentTemperature());
}

// Function to set specific temperature
function setTemp(value: number) {
  dmActor.send({ type: "SET_TEMPERATURE", temperature: value });
  console.log("Temperature set to:", value);
}

// Function to change model
function changeModel(newModel: string) {
  dmActor.send({ type: "CHANGE_MODEL", model: newModel });
  console.log("Model changed to:", newModel);
}



const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    sst_prepare: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
    sst_listen: ({ context }) => context.spstRef.send({ type: "LISTEN" }),
    appendUserMessage: assign({
      messages: ({ context, event }) => [
        ...context.messages,
        { role: "user", content: (event as any).value[0].utterance }
      ]
    }),
    appendAssistantMessage: assign({
      messages: ({ context, event }) => [
        ...context.messages,
        { role: "assistant", content: (event as any).output }
      ]
    }),
    speakLastMessage: ({ context }) => {
      const lastMessage = context.messages[context.messages.length - 1];
      if (lastMessage.role === "assistant") {
        console.log("Speaking:", lastMessage.content);
        context.spstRef.send({
          type: "SPEAK",
          value: { utterance: lastMessage.content },
        });
      }
    },
    speakNoInputPrompt: ({ context }) => {
      const noinputCount = context.noinputCounter || 0;
      let prompt = "";
      
      if (noinputCount === 1) {
        prompt = "I didn't hear anything. Please speak again.";
      } else if (noinputCount >= 2) {
        prompt = "I haven't heard from you in a while. Feel free to speak when you're ready, or say goodbye if you're done chatting.";
      }
      
      console.log("Speaking no-input prompt:", prompt);
      context.spstRef.send({
        type: "SPEAK",
        value: { utterance: prompt },
      });
    },
    incrementNoInputCounter: assign({
      noinputCounter: ({ context }) => {
        const newCount = (context.noinputCounter || 0) + 1;
        console.log("NOINPUT counter:", newCount);
        return newCount;
      }
    }),
    resetNoInputCounter: assign({
      noinputCounter: 0
    }),
    addNoInputPrompt: assign({
      messages: ({ context }) => {
        const noinputCount = context.noinputCounter || 0;
        let prompt = "";
        
        if (noinputCount === 1) {
          prompt = "I didn't hear anything. Please speak again.";
        } else if (noinputCount >= 2) {
          prompt = "I haven't heard from you in a while. Feel free to speak when you're ready, or say goodbye if you're done chatting.";
        }
        
        return [
          ...context.messages,
          { role: "assistant", content: prompt }
        ];
      }
    }),

    // New actions for temperature and model control
    increaseTemperature: assign({
      temperature: ({ context }) => Math.min(1.0, (context.temperature || 0.7) + 0.1)
    }),
    decreaseTemperature: assign({
      temperature: ({ context }) => Math.max(0.1, (context.temperature || 0.7) - 0.1)
    }),
    setTemperature: assign({
      temperature: ({ context, event }) => (event as any).temperature
    }),
    changeModel: assign({
      currentModel: ({ context, event }) => (event as any).model
    }),

    // New actions for top_k: Reduces the probability of generating nonsense
    increaseTopK: assign({
      top_k: ({ context }) => Math.min(500, (context.top_k || 100) + 10)
    }),
    decreaseTopK: assign({
      top_k: ({ context }) => Math.max(1, (context.top_k || 100) - 10)
    }),
    setTopK: assign({
      top_k: ({ context, event }) => (event as any).top_k
    })
    
  },
  
  actors: {
    getModels: fromPromise<any,null>(()=> 
      fetch("http://localhost:11434/api/tags").then((response) =>
        response.json()
      )
    ),
    chatCompletion: fromPromise(async ({ input }: { input: { messages: Message[], model: string, temperature: number, top_k: number } }) => {
      return await fetchLLM(input.messages, input.model, input.temperature, input.top_k);
    })
  }
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    informationState: { latestMove: "ping" },
    lastResult: "",
    messages: [
      {
        role: "system",
        content: "You are a friendly chatbot. Keep your responses brief and conversational."
      }
    ],

    noinputCounter: 0,
    temperature: 0.7, // Default temperature
    currentModel: "llama3.1", // Default model
    top_k: 100  // Default top_k value

  }),
  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "Idle",
      },
    },
    Idle: {
      description: "Waiting for user to click button to start conversation",
      on: {
        CLICK: {
          target: "Loop",
          actions: assign({
            messages: ({ context }) => [
              ...context.messages,
              { role: "assistant", content: "Hello! How can I help you today?" }
            ]
          })
        },

        // New events for temperature control
        INCREASE_TEMPERATURE: {
          actions: "increaseTemperature"
        },
        DECREASE_TEMPERATURE: {
          actions: "decreaseTemperature"
        },
        SET_TEMPERATURE: {
          actions: "setTemperature"
        },
        CHANGE_MODEL: {
          actions: "changeModel"
        },

        INCREASE_TOP_K: {
          actions: "increaseTopK"
        },
        DECREASE_TOP_K: {
          actions: "decreaseTopK"  
        },
        SET_TOP_K: {
          actions: "setTopK"
        }

      }

    },
    Loop: {
      initial: "Speaking",
      states: {
        Speaking: {
          entry: "speakLastMessage",
          on: {
            SPEAK_COMPLETE: "Ask",

            // ADD TEMPERATURE CONTROLS HERE TOO
            INCREASE_TEMPERATURE: {
              actions: "increaseTemperature"
            },
            DECREASE_TEMPERATURE: {
              actions: "decreaseTemperature"
            },
            SET_TEMPERATURE: {
              actions: "setTemperature"
            },
            CHANGE_MODEL: {
              actions: "changeModel"
            },

            INCREASE_TOP_K: {
              actions: "increaseTopK"
            },
            DECREASE_TOP_K: {
              actions: "decreaseTopK"  
            },
            SET_TOP_K: {
              actions: "setTopK"
            },

            LISTEN_COMPLETE: "Ask", // <-- add this fallback
          }
        },
        Ask: {
          entry: ["sst_listen"], // 👈 removed reset here
          on: {
            RECOGNISED: {
              actions: ["appendUserMessage", "resetNoInputCounter"],
              target: "ChatCompletion"
            },
            ASR_NOINPUT: {
              actions: [
                "incrementNoInputCounter", 

            // Static prompt only (simplest fix)

            //     "addNoInputPrompt",
            //     "speakNoInputPrompt"   // 👈 now it always speaks after noinput
            //   ],
            //   target: "Speaking" // Then go to Speaking to continue normal flow
            // },
                // Dynamic prompt from LLM
                // Tradeoff:
                // •	Static = predictable, fast, no LLM call.
                // •	LLM = more natural, but costs latency and tokens each time silence occurs.

                        // ADD AUTOMATIC TEMPERATURE ADJUSTMENT HERE
                assign({
                  temperature: ({ context }) => {
                    // Increase creativity when user is silent multiple times
                    if (context.noinputCounter >= 2) {
                      console.log("Auto-increasing temperature to 0.9 due to silence");
                      return 1; // More creative prompts to re-engage
                    }
                    return context.temperature; // Keep current temperature otherwise
                  }
                }),

                assign(({ context }) => ({
                  messages: [
                    ...context.messages,
                    { role: "user", content: "The user was silent. Suggest a polite prompt to encourage them to speak." }
                  ]
                }))
              ],
              target: "ChatCompletion"  // 👈 ask LLM instead of static Speaking
            },


            LISTEN_COMPLETE: {
              // This handles normal completion when user speaks
              target: "Speaking"
            },
            // ADD TEMPERATURE CONTROLS HERE TOO
            INCREASE_TEMPERATURE: {
              actions: "increaseTemperature"
            },
            DECREASE_TEMPERATURE: {
              actions: "decreaseTemperature"
            },
            SET_TEMPERATURE: {
              actions: "setTemperature"
            },
            CHANGE_MODEL: {
              actions: "changeModel"
            },

            INCREASE_TOP_K: {
              actions: "increaseTopK"
            },
            DECREASE_TOP_K: {
              actions: "decreaseTopK"  
            },
            SET_TOP_K: {
              actions: "setTopK"
            }
          }
        },
        ChatCompletion: {
          invoke: {
            src: "chatCompletion",
            input: ({ context }) => ({ 
                messages: context.messages,
                model: context.currentModel,
                temperature: context.temperature,
                top_k: context.top_k  // Pass top_k to the LLM call
              }),
            onDone: {
              target: "Speaking",
              actions: "appendAssistantMessage"
            },
            onError: {
              target: "Speaking",
              actions: assign({
                messages: ({ context }) => [
                  ...context.messages,
                  { 
                    role: "assistant", 
                    content: "I apologize, but I'm having trouble processing your request right now." 
                  }
                ]
              })
            }
          }
        },
        // ADD TEMPERATURE CONTROLS HERE TOO
        on: {
          INCREASE_TEMPERATURE: {
            actions: "increaseTemperature"
          },
          DECREASE_TEMPERATURE: {
            actions: "decreaseTemperature"
          },
          SET_TEMPERATURE: {
            actions: "setTemperature"
          },
          CHANGE_MODEL: {
            actions: "changeModel"
          },
          
          INCREASE_TOP_K: {
            actions: "increaseTopK"
          },
          DECREASE_TOP_K: {
            actions: "decreaseTopK"  
          },
          SET_TOP_K: {
            actions: "setTopK"
          }
        }

      },

      // ADD TEMPERATURE CONTROLS TO THE LOOP LEVEL TOO
      on: {
        INCREASE_TEMPERATURE: {
          actions: "increaseTemperature"
        },
        DECREASE_TEMPERATURE: {
          actions: "decreaseTemperature"
        },
        SET_TEMPERATURE: {
          actions: "setTemperature"
        },
        CHANGE_MODEL: {
          actions: "changeModel"
        },

        INCREASE_TOP_K: {
          actions: "increaseTopK"
        },
        DECREASE_TOP_K: {
          actions: "decreaseTopK"  
        },
        SET_TOP_K: {
          actions: "setTopK"
        }
      }
      
    }
  }
});

const dmActor = createActor(dmMachine, {}).start();

// Export functions to control temperature and model externally
export function increaseTemperature() {
  dmActor.send({ type: "INCREASE_TEMPERATURE" });
}

export function decreaseTemperature() {
  dmActor.send({ type: "DECREASE_TEMPERATURE" });
}

export function setTemperature(temperature: number) {
  dmActor.send({ type: "SET_TEMPERATURE", temperature });
}

// export function changeModel(model: string) {
//   dmActor.send({ type: "CHANGE_MODEL", model });
// }

export function getCurrentTemperature(): number {
  return dmActor.getSnapshot().context.temperature;
}

export function getCurrentModel(): string {
  return dmActor.getSnapshot().context.currentModel;
}

export function increaseTopK() {
  dmActor.send({ type: "INCREASE_TOP_K" });
}

export function decreaseTopK() {
  dmActor.send({ type: "DECREASE_TOP_K" });
}

export function setTopK(top_k: number) {
  dmActor.send({ type: "SET_TOP_K", top_k });
}

export function getCurrentTopK(): number {
  return dmActor.getSnapshot().context.top_k;
}

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