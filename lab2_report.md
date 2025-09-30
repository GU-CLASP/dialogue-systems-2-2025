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

2.