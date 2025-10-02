import "./style.css";
import { setupButton, increaseTemperature, decreaseTemperature, setTemperature, getCurrentTemperature } from "./dm.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <h1>Voice Chatbot - lab2 - LLMs for dialogue systems - Chit-chat with SpeechState</h1>
    
    <div class="controls">
      <div class="temperature-controls">
        <h3>Temperature Controls</h3>
        <button id="decrease-temp">- Temp</button>
        <span id="current-temp">0.7</span>
        <button id="increase-temp">+ Temp</button>
        
        <div class="preset-temps">
          <button class="temp-preset" data-temp="0.1">Low (0.1)</button>
          <button class="temp-preset" data-temp="0.7">Medium (0.7)</button>
          <button class="temp-preset" data-temp="1.0">High (1.0)</button>
        </div>
      </div>
    </div>

    <div class="card">
      <button id="counter" type="button">Start Chat</button>
    </div>

    <div class="status">
      <p>Current Temperature: <span id="temp-display">0.7</span></p>
    </div>
  </div>
`;

// Setup the main chat button
setupButton(document.querySelector<HTMLButtonElement>("#counter")!);

// Setup temperature control buttons
const increaseTempBtn = document.querySelector<HTMLButtonElement>("#increase-temp")!;
const decreaseTempBtn = document.querySelector<HTMLButtonElement>("#decrease-temp")!;
const tempPresetBtns = document.querySelectorAll<HTMLButtonElement>(".temp-preset");
const tempDisplay = document.querySelector<HTMLSpanElement>("#temp-display")!;

increaseTempBtn.addEventListener("click", () => {
  increaseTemperature();
  updateTemperatureDisplay();
});

decreaseTempBtn.addEventListener("click", () => {
  decreaseTemperature();
  updateTemperatureDisplay();
});

tempPresetBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const temp = parseFloat(btn.dataset.temp!);
    setTemperature(temp);
    updateTemperatureDisplay();
  });
});

// Function to update temperature display
function updateTemperatureDisplay() {
  const currentTemp = getCurrentTemperature();
  tempDisplay.textContent = currentTemp.toFixed(1);
  
  // Update the current temperature span in controls too
  const currentTempSpan = document.querySelector<HTMLSpanElement>("#current-temp");
  if (currentTempSpan) {
    currentTempSpan.textContent = currentTemp.toFixed(1);
  }
  
  console.log("Temperature updated to:", currentTemp);
}

// Update display initially
updateTemperatureDisplay();


// import "./style.css";
// import { setupButton } from "./dm.ts";

// document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
//   <div>
//     <div class="card">
//       <button id="counter" type="button"></button>
//     </div>
//   </div>
// `;

// setupButton(document.querySelector<HTMLButtonElement>("#counter")!);