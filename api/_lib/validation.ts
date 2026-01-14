// Input validation utilities

// Allowed registries - add more as needed
const ALLOWED_REGISTRIES = [
  'docker.io',
  'ghcr.io',
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
  imageUrl = imageUrl.trim();

  // Check for dangerous characters
  if (/[<>;"'`$(){}[\]\\|&]/.test(imageUrl)) {
    return { valid: false, error: 'Image URL contains invalid characters' };
  }

  // Validate format with regex
  if (!DOCKER_IMAGE_PATTERN.test(imageUrl)) {
    return { valid: false, error: 'Invalid Docker image URL format' };
  }

  // Extract registry if present
  let registry = 'docker.io';
  if (imageUrl.includes('/')) {
    const firstPart = imageUrl.split('/')[0];
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

  return { valid: true };
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
