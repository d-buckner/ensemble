import { createActorToken } from '@d-buckner/ensemble-core';
import type { CounterActor } from './actors/CounterActor';


export const CounterToken = createActorToken<CounterActor>('counter');
