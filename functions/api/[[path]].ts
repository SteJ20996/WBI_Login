import { error } from '../_lib/http';
import type { Fn } from '../_lib/types';

/** Any /api/ address that is not a real endpoint. */
export const onRequest: Fn = async () => error('not_found', 404);
