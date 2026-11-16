const CopyMailStatistics = (() => {
    'use strict';

    const STORAGE_KEY = 'actionStatistics';
    const DAY_SECONDS = 86400;
    const MessageType = Object.freeze({ INCREMENT: 'statistics.increment', TOTALS: 'statistics.totals' });

    class IncrementMessage {
        constructor(action) {
            if (!Object.values(CopyMailSettings.Action).includes(action)) {
                throw new Error(`Unsupported action: ${action}`);
            }
            this.type = MessageType.INCREMENT;
            this.action = action;
        }
    }

    class Statistics {
        // Each action owns an array of nonempty Map<UTC day timestamp, click count>.
        #days = new Map();
        #storage;

        constructor(storage = globalThis.chrome?.storage?.local) {
            this.#storage = storage;
        }

        async load() {
            const stored = (await this.#storage.get(STORAGE_KEY))[STORAGE_KEY] ?? {};
            this.#days = new Map(Object.values(CopyMailSettings.Action).map(action => [action,
                (stored[action] ?? []).map(day => new Map(Object.entries(day).map(([timestamp, count]) => [Number(timestamp), count])))
                    .filter(day => day.size > 0)
            ]));
        }

        async increment(action) {
            new IncrementMessage(action);
            const timestamp = Math.floor(Date.now() / 1000 / DAY_SECONDS) * DAY_SECONDS;
            const days = this.#days.get(action) ?? [];
            let day = days.find(item => item.has(timestamp));
            if (!day) {
                day = new Map();
                days.push(day);
                this.#days.set(action, days);
            }
            day.set(timestamp, (day.get(timestamp) ?? 0) + 1);
            await this.#storage.set({ [STORAGE_KEY]: this.#serialize() });
        }

        week(action) { return this.#total(7, action); }
        month(action) { return this.#total(30, action); }
        year(action) { return this.#total(365, action); }
        lifetime(action) { return this.#total(Infinity, action); }

        #total(days, action) {
            const today = Math.floor(Date.now() / 1000 / DAY_SECONDS) * DAY_SECONDS;
            const start = today - (days - 1) * DAY_SECONDS;
            let total = 0;
            for (const [key, records] of this.#days) {
                if (action !== undefined && key !== action) continue;
                for (const day of records) {
                    for (const [timestamp, count] of day) {
                        if (timestamp >= start && timestamp <= today) total += count;
                    }
                }
            }
            return total;
        }

        #serialize() {
            return Object.fromEntries([...this.#days].filter(([, days]) => days.length)
                .map(([action, days]) => [action, days.map(day => Object.fromEntries(day))]));
        }

    }

    return Object.freeze({ Statistics, STORAGE_KEY, MessageType, IncrementMessage });
})();
