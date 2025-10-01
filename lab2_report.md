# Assignment Lab2. LLMs for dialogue systems

## Part 2: Exploration

Option 1: further experiments with chit-chat LLM

1. Handling of ASR_NOINPUT

To handle the situation when there is no input from the user, my first idea was to manually assign a new message in *messages* for the system to utter, and modify the LISTEN_COMPLETE to transition to *ChatCompletion* only when there is some input, while transiting directly to *Speaking* in case of no input:

```typescript
Asking: {
    entry: "sst_listen",
    on: {
        LISTEN_COMPLETE: [{
            target: "ChatCompletion",
            guard: ({ context}) => context.messages[context.messages.length -1].role === "user"
            },
            {target: "Speaking"}],
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
                {role: "system", content: "I didn't hear anything from you."}
                ],
            }),
        },
    }
},
```
It worked but it was a bit boring. Indeed, there was no variation as the exact same message would pop up each time the user stayed silent.

I then modified the code to take advantage of the LLM generation and made the system prompt the LLM to repeat or summarize what it just said:
 ```typescript
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
                {role: "system", content: "if the user does not respond, kindly repeat or summarize your last turn or change topic to keep the conversation going. Always say something to encourage the user to respond."}
                ],
            }),
        },
    }
},
 ```
Here, the system message was not always taken into account. In some conversation, I had to wait for the third silent user turn to get an appropriate reply from the LLM, despite the last sentence in the system message being really specific.

Finally, I modified the role from 'system' to 'user' when assigning the message in case of no input and it started to behave better. My understanding is that the assistant reacts more directly to the user's messages while system's messages act more like background instructions for the assistant and are not always responded immediately. So faking the role 'user' in this case is a trick to trigger an immediate desirable reply from the LLM.
```typescript
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
                ],
            }),
        },
    }
},
```
Now, there is more variation in the way the system responds to no input. However, sometimes the LLM generates weird responses, that sound unnatural, for instance:
- 'I said[...] - just a generic greeting, nothing specific.' or,
- 'I said "Hiya! How's it going?" (just a casual hello). What would you like to talk about instead?'

Thus, there is still some room for improvement. A solution to explore might be using a system message to instruct the assistant to repeat without making it obvious that it's a repetition.

2. Adjusting options

To test the impact of temperature, I prompted the model with the exact same prompt, several times and for two temperature values. With temperature = 0 there is less variation between outputs, while with temperature = 1, there is more creativity and the turns are also longer.

Prompt: *Tell me a story about a dragon and a baker*

Generated outputs with temperature = 0:
- In a quaint village, a fiery dragon named Blaze befriended a kind baker named Emma.
- In a small village, a gentle baker named Emma lived next to a fierce dragon named Blaze. One day...
- In a tiny village, a brave baker named Emma befriend a fiery dragon, Scorch. He'd sneak into her shop at night to trade loaves for sparkly gems.
- In a land of sweet treats, a baker named Max lived next to a fire-breathing dragon named Scorch. One day...

Generated outputs with temperature = 1:
- Once, in a land of sweet treats, a baker named Emma made the most mouthwatering pastries. One day, a friendly dragon named Blaze flew by her bakery, craving something delicious!
- In a tiny village, a friendly dragon named Ember befriended Baker Bob, who made the most scrumptious pastries in town. One day, Ember asked Bob to bake a cake for her birthday!
- In a village, a baker named Bob made a special cake for a legendary dragon. The dragon, named Blaze, had a sweet tooth and a love for Bob's treats.
- In a village nestled between two great mountains, a legendary baker named Emilia created pastries that granted wishes to those who ate them. One day, a fierce dragon named Scorch descended upon the village, breathing fire and destruction

I then wanted to make the model more deterministic and set a seed, expecting to get the exact same output for a given prompt. However, even with a temperature = 0, it did not work as expected as I get two different outputs for a given prompt (same as before) (Note: the machine was re-started in-between tests to avoid messages accumulation in the history and a non-repetition due to the repeat_penalty).

Generated outputs with seed = 9 and temperature = 0:
- In a land of sweet treats, a fierce dragon named Blaze had a weakness for freshly baked bread. He'd fly over villages, sniffing out the best bakeries. One day, he landed on the doorstep of Mrs. Whiskers' bakery, where she handed him a warm loaf and said, "Now, don't burn down my shop!"
- In the land of Sweetopia, a gentle dragon named Blaze befriended Bertha, a kind-hearted baker. She'd bake him treats with fireproof wrappers so he could enjoy her yummy pastries on his morning fly-bys!

My understanding is that this non-repeatability is due to the quantization of the model, which reduces the model size and performance but may introduce some additional randomness.