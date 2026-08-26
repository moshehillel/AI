import type { ChangeClassification } from "@automation-studio/db";

const HIGH_RISK_PATTERNS = [
  /\bauth(entication|orization)?\b/i,
  /\bpermission(s)?\b/i,
  /\b(password|secret|credential|api[_\s-]?key)\b/i,
  /\b(payment|billing|stripe|charge|refund)\b/i,
  /\b(delete|drop|truncate|destroy)\b.+\b(data|table|database|user|record)/i,
  /\b(production|infra(structure)?|deploy|kubernetes|terraform)\b/i,
  /\b(rbac|acl|oauth|sso|jwt)\b/i,
];

const COMPLEX_PATTERNS = [
  /\bschema\b/i,
  /\bdatabase\b/i,
  /\bmigrat/i,
  /\barchitect/i,
  /\bmulti[- ]?service\b/i,
  /\bintegration\b/i,
  /\brewrite\b/i,
  /\brefact(or|oring)\b/i,
];

const SIMPLE_PATTERNS = [
  /\b(typo|label|text|copy|wording)\b/i,
  /\b(color|style|css|spacing|padding|margin|font)\b/i,
  /\b(button|tooltip|placeholder)\b/i,
  /\bsimple\b/i,
  /\bui\b.+\b(tweak|adjust|change)\b/i,
];

export type ClassificationResult = {
  classification: ChangeClassification;
  reasons: string[];
  requiresPlan: boolean;
  requiresDeveloperPreApproval: boolean;
};

export function classifyChangeRequest(input: {
  title: string;
  description: string;
}): ClassificationResult {
  const text = `${input.title}\n${input.description}`.trim();
  const reasons: string[] = [];

  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(`Matched high-risk pattern: ${pattern.source}`);
      return {
        classification: "HIGH_RISK",
        reasons,
        requiresPlan: true,
        requiresDeveloperPreApproval: true,
      };
    }
  }

  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push(`Matched complex pattern: ${pattern.source}`);
      return {
        classification: "COMPLEX",
        reasons,
        requiresPlan: true,
        requiresDeveloperPreApproval: false,
      };
    }
  }

  let simpleHits = 0;
  for (const pattern of SIMPLE_PATTERNS) {
    if (pattern.test(text)) {
      simpleHits += 1;
      reasons.push(`Matched simple pattern: ${pattern.source}`);
    }
  }

  if (simpleHits >= 1 && text.length < 280) {
    return {
      classification: "SIMPLE",
      reasons,
      requiresPlan: false,
      requiresDeveloperPreApproval: false,
    };
  }

  reasons.push("Defaulted to NORMAL feature/workflow change");
  return {
    classification: "NORMAL",
    reasons,
    requiresPlan: false,
    requiresDeveloperPreApproval: false,
  };
}
