type BraveNavigator = Navigator & { brave?: { isBrave?: () => Promise<boolean> } };

/**
 * Brave exposes webkitSpeechRecognition but cannot reach Google's recognition
 * service, so every attempt ends in a "network" error. Detect it up front.
 */
export async function isBraveBrowser(target: Navigator = navigator): Promise<boolean> {
  const brave = (target as BraveNavigator).brave;
  if (typeof brave?.isBrave !== "function") return false;
  try {
    return await brave.isBrave();
  } catch {
    return false;
  }
}
