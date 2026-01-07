export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ValidationHelper {
  static required(value: unknown, fieldName: string): void {
    if (value === undefined || value === null || value === "") {
      throw new ValidationError(`${fieldName} is required`);
    }
  }

  static nonEmpty(value: string, fieldName: string): void {
    if (!value || value.trim().length === 0) {
      throw new ValidationError(`${fieldName} cannot be empty`);
    }
  }

  static positiveNumber(value: number, fieldName: string): void {
    if (value <= 0) {
      throw new ValidationError(`${fieldName} must be a positive number`);
    }
  }

  static validBranch(value: string): void {
    const branchRegex = /^[a-zA-Z0-9_\-\/\.]+$/;
    if (!branchRegex.test(value)) {
      throw new ValidationError(`Invalid branch name: ${value}`);
    }
  }

  static validUrl(url: string): void {
    try {
      new URL(url);
    } catch {
      throw new ValidationError(`Invalid URL: ${url}`);
    }
  }

  static validateMRParams(params: {
    sourceBranch: string;
    targetBranch: string;
    title: string;
  }): void {
    this.nonEmpty(params.sourceBranch, "sourceBranch");
    this.nonEmpty(params.targetBranch, "targetBranch");
    this.nonEmpty(params.title, "title");
    this.validBranch(params.sourceBranch);
    this.validBranch(params.targetBranch);
  }

  static validateIssueParams(params: { title: string }): void {
    this.nonEmpty(params.title, "title");
  }

  static validateMRId(id: string | number): number {
    const num = typeof id === "string" ? parseInt(id, 10) : id;
    if (isNaN(num) || num <= 0) {
      throw new ValidationError(`Invalid MR ID: ${id}`);
    }
    return num;
  }

  static validateIssueId(id: string | number): number {
    const num = typeof id === "string" ? parseInt(id, 10) : id;
    if (isNaN(num) || num <= 0) {
      throw new ValidationError(`Invalid Issue ID: ${id}`);
    }
    return num;
  }
}
