import { app } from "../../scripts/app.js";

app.registerExtension({
  name: "pathlight.comfyui",
  async setup() {
    try {
      const response = await fetch("/pathlight/comfyui/config");
      if (response.ok) {
        const config = await response.json();
        console.info("[Pathlight] ComfyUI tracing loaded", config);
      }
    } catch (error) {
      console.warn("[Pathlight] ComfyUI tracing config unavailable", error);
    }
  },
});
