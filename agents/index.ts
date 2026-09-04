import { analyticsAgent } from "./analytics";
import { ceoAgent } from "./ceo";
import { checkoutAgent } from "./checkout";
import { customerAgent } from "./customer";
import { fulfillmentAgent } from "./fulfillment";
import { inventoryAgent } from "./inventory";
import { marketingAgent } from "./marketing";
import { pricingAgent } from "./pricing";
import { procurementAgent } from "./procurement";
import type { Agent } from "./runtime";
import type { AgentId } from "@/types";

export const AGENT_REGISTRY: Record<AgentId, Agent> = {
  ceo: ceoAgent,
  analytics: analyticsAgent,
  inventory: inventoryAgent,
  pricing: pricingAgent,
  marketing: marketingAgent,
  customer: customerAgent,
  procurement: procurementAgent,
  fulfillment: fulfillmentAgent,
  checkout: checkoutAgent,
};

export const getAgentImpl = (id: AgentId): Agent => AGENT_REGISTRY[id];

export * from "./definitions";
export type { Agent, AgentRunContext } from "./runtime";
