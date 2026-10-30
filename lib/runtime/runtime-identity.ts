/** The fixed identity of the local Hermes runtime. */
export const LOCAL_HERMES_RUNTIME_ID = "local";

/** A stored model default is keyed by one of these runtime identities. */
export const RUNTIME_ID_PATTERN = /^(?:local|remote-[a-f0-9]{8,64})$/;
