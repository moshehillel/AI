/**
 * Detect likely secrets in chat text and return redacted content + captures.
 * MVP heuristics — never store plaintext in chat after detection.
 */

export type DetectedSecret = {
  keyName: string;
  value: string;
  label: string;
};

const PATTERNS: Array<{
  name: string;
  label: string;
  regex: RegExp;
}> = [
  {
    name: "OPENAI_API_KEY",
    label: "API key",
    regex: /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    name: "AWS_SECRET",
    label: "AWS secret",
    regex: /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/g,
  },
  {
    name: "BEARER_TOKEN",
    label: "bearer token",
    regex: /\b(?:Bearer\s+)([A-Za-z0-9._\-]{20,})\b/gi,
  },
  {
    name: "GENERIC_SECRET",
    label: "secret",
    regex:
      /\b(?:api[_-]?key|secret|password|token|passwd)\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
  },
  {
    name: "PRIVATE_KEY",
    label: "private key",
    regex: /(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/g,
  },
];

export function detectAndRedactSecrets(content: string): {
  redacted: string;
  secrets: DetectedSecret[];
  hadSecrets: boolean;
} {
  const secrets: DetectedSecret[] = [];
  let redacted = content;
  let counter = 0;

  for (const pattern of PATTERNS) {
    redacted = redacted.replace(pattern.regex, (_match, value: string) => {
      counter += 1;
      const keyName = `${pattern.name}_${counter}`;
      secrets.push({
        keyName,
        value: value ?? _match,
        label: pattern.label,
      });
      return `[${pattern.label} saved securely — ref: ${keyName}]`;
    });
  }

  return {
    redacted,
    secrets,
    hadSecrets: secrets.length > 0,
  };
}
