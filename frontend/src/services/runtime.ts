// Browser mode is the deployment default. run-dev.bat explicitly selects legacy mode.
export const browserMode = import.meta.env.VITE_RUNTIME !== 'legacy'
