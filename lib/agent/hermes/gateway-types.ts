export type HermesGatewayEvent = {
  type: string;
  session_id?: string;
  payload?: Record<string, unknown>;
};

export type HermesJsonRpcFrame = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: HermesGatewayEvent;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

export type HermesSessionResponse = {
  session_id: string;
  stored_session_id?: string;
  session_key?: string;
  resumed?: string;
  status?: string;
  running?: boolean;
  messages?: Array<{
    role?: string;
    text?: string;
    name?: string;
    context?: string;
  }>;
  inflight?: {
    assistant?: string;
    error?: string;
    status?: string;
    streaming?: boolean;
  } | null;
};

export type HermesToolPayload = {
  tool_id?: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  context?: string;
  summary?: string;
  duration_s?: number;
};

export type HermesCompletionResponse = {
  items?: Array<{
    text?: string;
    display?: string;
    meta?: string;
    kind?: string;
  }>;
  replace_from?: number;
};

export type HermesCommandsCatalogResponse = {
  pairs?: Array<[string, string]>;
  categories?: Array<{
    name?: string;
    pairs?: Array<[string, string]>;
  }>;
  skills?: Record<string, { usage?: number; origin?: string }>;
  skill_count?: number;
  warning?: string;
};

export type HermesModelOptionsResponse = {
  provider?: string;
  model?: string;
  providers?: Array<{
    slug?: string;
    name?: string;
    models?: unknown[];
    is_current?: boolean;
    authenticated?: boolean;
    warning?: string;
  }>;
};

export type HermesModelSwitchResponse = {
  key?: string;
  value?: string;
  warning?: string;
  confirm_required?: boolean;
  confirm_message?: string;
  deferred?: boolean;
  scope?: string;
};

export type HermesCommandDispatch =
  | { type: "exec" | "plugin"; output?: string }
  | { type: "alias"; target?: string }
  | {
      type: "skill";
      name?: string;
      message?: string;
      display?: string;
    }
  | {
      type: "send";
      message?: string;
      notice?: string;
      display?: string;
    }
  | { type: "prefill"; message?: string; notice?: string };

export type HermesSlashExecResponse = {
  output?: string;
  warning?: string;
  type?: string;
  target?: string;
  name?: string;
  message?: string;
  notice?: string;
  display?: string;
};
