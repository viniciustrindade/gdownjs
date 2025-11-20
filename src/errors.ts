"use strict";

export class GdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GdownError";
    Object.setPrototypeOf(this, GdownError.prototype);
  }
}

export class RateLimitError extends GdownError {
  constructor(message: string = "Rate limit exceeded") {
    super(message);
    this.name = "RateLimitError";
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class FileNotFoundError extends GdownError {
  constructor(message: string = "File not found") {
    super(message);
    this.name = "FileNotFoundError";
    Object.setPrototypeOf(this, FileNotFoundError.prototype);
  }
}

export class PermissionError extends GdownError {
  constructor(message: string = "Permission denied") {
    super(message);
    this.name = "PermissionError";
    Object.setPrototypeOf(this, PermissionError.prototype);
  }
}

export class VerificationError extends GdownError {
  constructor(message: string = "File verification failed") {
    super(message);
    this.name = "VerificationError";
    Object.setPrototypeOf(this, VerificationError.prototype);
  }
}

