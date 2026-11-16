'use strict';

importScripts('settings.js', 'statistics.js');

const { Statistics, MessageType, IncrementMessage } = CopyMailStatistics;
const statistics = new Statistics();
let loaded = false;
let pending = Promise.resolve();

// One writer serializes clicks and their local-storage writes across all tabs/frames.
function enqueue(operation) {
    const result = pending.then(async () => {
        if (!loaded) {
            await statistics.load();
            loaded = true;
        }
        return operation();
    });
    pending = result.catch(error => console.warn('CopyEmail statistics could not be updated.', error));
    return result;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
    switch (message?.type) {
        case MessageType.INCREMENT: {
            let increment;
            try { increment = new IncrementMessage(message.action); }
            catch { respond({ error: 'Unsupported action' }); return false; }
            enqueue(() => statistics.increment(increment.action))
                .then(() => respond({ ok: true }), () => respond({ error: 'Statistics unavailable' }));
            return true;
        }
        case MessageType.TOTALS:
            enqueue(() => ({ week: statistics.week(), month: statistics.month(), year: statistics.year(), lifetime: statistics.lifetime() }))
                .then(respond, () => respond({ error: 'Statistics unavailable' }));
            return true;
        default:
            return false;
    }
});
