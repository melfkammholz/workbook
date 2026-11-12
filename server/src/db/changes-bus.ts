import { EventEmitter } from 'node:events';

/** Told whenever the assistant inbox changes (proposed, decided, undone), so open tabs can look again at once. */
export const changesBus = new EventEmitter();
changesBus.setMaxListeners(0);
export const announceChanges = (): void => void changesBus.emit('changes');
