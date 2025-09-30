## Problems encountered in the experiment
## 1. Ollama default port `11434` conflict
## When I first tried to connect to the Ollama server, all API requests failed with connection errors because port `11434` was already occupied by another process. The dialogue manager could not fetch available models or generate replies.
## -> solution: I changed the fetch URLs from `11434` to `11435`. After this adjustment, the system was able to retrieve available models (llama3.2) and successfully call the chat endpoint.

## 2. `speechstate` did not recognize my voice input
## Initially, the ASR part of speechstate did not produce any transcription results, so the system always returned silence. The console showed repeated transitions between Ask → ChatCompletion without capturing my spoken words.
## -> solution: (1) I confirmed microphone permissions in the browser;
## (2) I updated the code so that every time the state enters Ask, a LISTEN event is explicitly sent

## 3. TTS spoke empty utterances
## Another issue was that sometimes the LLM response came back as an empty string or whitespace, and the TTS component would still try to speak it. This led to awkward silences where the system seemed unresponsive.
## -> solution: I added a guard in the ChatCompletion state to check if the LLM output was non-empty. If not, the system falls back to a default utterance. This ensured that TTS always had something to speak, avoiding silent responses.

## Strength: The dialogue flow (Speaking → Ask → ChatCompletion) works reliably and enables continuous conversation.
## Weakness: LLM responses are occasionally too long or not aligned with the chit-chat style.





