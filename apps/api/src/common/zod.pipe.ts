import { PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';
import { DmFlowError } from '@dmflow/shared';

/** Validates at the boundary and strips unknown fields. */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new DmFlowError('VALIDATION_FAILED', {
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
          code: i.code,
        })),
      });
    }
    return result.data;
  }
}

export function zodBody<T extends ZodTypeAny>(schema: T) {
  return new ZodValidationPipe(schema);
}
