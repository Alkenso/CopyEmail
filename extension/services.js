'use strict';

/** A prepared value for an action; executing it belongs to PageAugmenter. */
class Command {
    constructor(action, value) {
        this.action = action;
        this.value = value;
    }
}

class ServiceCollection {
    commands(detection) {
        return detection.rule.enabledActions.map(action => {
            if (action === Action.COPY) {
                return new Command(action, detection.value);
            }
            if (action === Action.OPEN_LINK && detection.rule.builtinType === 'address') {
                return new Command(action, `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(detection.value)}`);
            }
            throw new Error(`Unsupported action: ${action}`);
        });
    }
}
