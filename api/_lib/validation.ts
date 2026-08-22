// Input validation utilities

// Allowed registries - add more as needed
const ALLOWED_REGISTRIES = [
  'docker.io',
  'ghcr.io',
  'nvcr.io',
  'gcr.io',
  'registry.hub.docker.com',
  'quay.io',
  'registry.cn-shenzhen.aliyuncs.com',
  'registry.cn-hangzhou.aliyuncs.com',
  'registry.cn-beijing.aliyuncs.com',
  'registry.cn-shanghai.aliyuncs.com',
];

// Docker image URL pattern: [registry/][namespace/]repository[:tag]
// Strict validation to prevent injection
const DOCKER_IMAGE_PATTERN = /^([a-z0-9](?:[a-z0-9-_.]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-_.]*[a-z0-9])?)*(?::\d+)?\/)?([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)(?::([a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}))?$/i;

export interface ValidationResult {
  valid: boolean;
  // The normalized (trimmed) value. Callers MUST use this rather than the
  // string they passed in: validating one string and then acting on another
  // is how leading/trailing whitespace slips through into workflow inputs.
  value?: string;
  error?: string;
}

export function validateImageUrl(imageUrl: string): ValidationResult {
  // Check basic format
  if (!imageUrl || typeof imageUrl !== 'string') {
    return { valid: false, error: 'Image URL is required' };
  }

  // Check length (prevent DoS)
  if (imageUrl.length > 500) {
    return { valid: false, error: 'Image URL is too long (max 500 characters)' };
  }

  // Trim whitespace
  const value = imageUrl.trim();

  if (!value) {
    return { valid: false, error: 'Image URL is required' };
  }

  // Reject any remaining whitespace or control character outright. The regex
  // below anchors with ^...$, and in JS `$` also matches just before a
  // trailing newline, so "nginx:1.27\n" would otherwise pass.
  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    return { valid: false, error: 'Image URL must not contain whitespace or control characters' };
  }

  // Check for dangerous characters
  if (/[<>;"'`$(){}[\]\\|&]/.test(value)) {
    return { valid: false, error: 'Image URL contains invalid characters' };
  }

  // Validate format with regex
  if (!DOCKER_IMAGE_PATTERN.test(value)) {
    return { valid: false, error: 'Invalid Docker image URL format' };
  }

  // Extract registry if present
  let registry = 'docker.io';
  if (value.includes('/')) {
    const firstPart = value.split('/')[0];
    // Check if first part looks like a registry (contains dot or port)
    if (firstPart.includes('.') || firstPart.includes(':')) {
      registry = firstPart.split(':')[0]; // Remove port if present
    }
  }

  // Validate registry is allowed
  if (!ALLOWED_REGISTRIES.includes(registry)) {
    return {
      valid: false,
      error: `Registry '${registry}' is not allowed. Allowed registries: ${ALLOWED_REGISTRIES.join(', ')}`,
    };
  }

  return { valid: true, value };
}

export function validateWorkflowType(workflowType: string): ValidationResult {
  if (!workflowType || typeof workflowType !== 'string') {
    return { valid: false, error: 'Workflow type is required' };
  }

  if (workflowType !== 'copy' && workflowType !== 'sync') {
    return { valid: false, error: 'Workflow type must be either "copy" or "sync"' };
  }

  return { valid: true };
}

export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .trim()
    .substring(0, maxLength)
    .replace(/[<>;"'`$(){}[\]\\|&]/g, ''); // Remove dangerous characters
}
