import { BotEngine } from './BotEngine.js';
import * as actions from '../actions/bookingActions.js';
import * as sessionStore from '../storage/sessionStore.js';

const engine = new BotEngine({
  actions,
  sessionStore,
});

export { engine };
