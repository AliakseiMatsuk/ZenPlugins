import _ from "underscore";
import {adaptAsyncFn, postProcessTransaction, provideScrapeDates} from "./adapters";
describe("adaptAsyncFn", () => {
    it("should call addAccount, addTransaction, setResult", () => {
        const setResultCalled = new Promise((resolve) => {
            global.ZenMoney = {
                addAccount: jest.fn(),
                addTransaction: jest.fn(),
                setResult: resolve,
                features: {},
            };
            const main = adaptAsyncFn(async () => [{account: "account", transactions: [1, 2]}]);
            main();
        });
        return expect(setResultCalled).resolves.toEqual({success: true}).then(x => {
            expect(global.ZenMoney.addAccount).toHaveBeenCalledTimes(1);
            expect(global.ZenMoney.addAccount).toHaveBeenCalledWith("account");
            expect(global.ZenMoney.addTransaction).toHaveBeenCalledTimes(1);
            expect(global.ZenMoney.addTransaction).toHaveBeenCalledWith([1, 2]);
        });
    });

    it("should fallback to setResult(error) when error thrown in async promise context", () => {
        const testError = new Error("test error");
        return expect(new Promise((resolve) => {
            global.ZenMoney = {
                setResult: resolve,
            };
            const main = adaptAsyncFn(async () => {
                throw testError;
            });
            main();
        })).resolves.toBe(testError);
    });

    it("should throw out errors thrown inside sync promise", () => {
        global.ZenMoney = {
            setResult: () => {
                throw new Error("setResult should not be called in sync promise context");
            },
        };
        const error = new Error("test error");
        const main = adaptAsyncFn(() => {
            return {
                then(resolveHandler, rejectionHandler) {
                    console.assert(resolveHandler);
                    console.assert(!rejectionHandler);
                    return {
                        then(resolveHandler, rejectionHandler) {
                            console.assert(resolveHandler);
                            console.assert(rejectionHandler);
                            rejectionHandler(error);
                        },
                    };
                },
            }
        });
        return expect(() => main()).toThrow(error);
    });

    it("should handle invalid usages synchronously", () => {
        expect(() => adaptAsyncFn(null)).toThrow("adaptAsyncFn argument is not a function");
        expect(() => adaptAsyncFn(_.noop)()).toThrow("scrape() did not return a promise");
    });

    it("should check promise returns an array", () => {
        return expect(new Promise((resolve) => {
            global.ZenMoney = {setResult: resolve};
            adaptAsyncFn(() => Promise.resolve())();
        })).resolves.toMatchObject({message: "scrape() result is not an array"});
    });

    it("should check promise result array is not empty", () => {
        return expect(new Promise((resolve) => {
            global.ZenMoney = {setResult: resolve};
            adaptAsyncFn(() => Promise.resolve([]))();
        })).resolves.toMatchObject({message: "scrape results are empty"});
    });

    [
        {account: null, transactions: []},
        {account: {}, transactions: null},
    ].forEach((invalidResultItem, i) => {
        it("should check promise result array items are correctly shaped " + i, () => {
            return expect(new Promise((resolve) => {
                global.ZenMoney = {setResult: resolve};
                adaptAsyncFn(() => Promise.resolve([invalidResultItem]))();
            })).resolves.toMatchObject({message: "scrape result should be array of {account, transactions[]}"});
        });
    });
});

describe("provideScrapeDates", () => {
    it("should provide scrape dates from startDate pref", () => {
        const startDate = "2010-01-01T01:01:01.000Z";
        global.ZenMoney = {
            getData: jest.fn(),
            setData: jest.fn(),
            saveData: jest.fn(),
            getPreferences: () => ({"startDate": startDate}),
        };

        const scrape = jest.fn().mockReturnValueOnce(Promise.resolve());
        const scrapeWithProvidedDates = provideScrapeDates(scrape);

        scrapeWithProvidedDates();
        expect(scrape).toHaveBeenCalledWith({fromDate: new Date(startDate), toDate: null});
    });

    it("should provide scrape fromDate equal to lastSuccessDate minus 1 week", () => {
        const lastSuccessDate = "2015-06-07T08:09:10.000Z";
        const expectedFromDate = "2015-05-31T08:09:10.000Z";
        const startDate = "2010-01-01T01:01:01.000Z";
        global.ZenMoney = {
            getData: jest.fn().mockReturnValueOnce(lastSuccessDate),
            setData: jest.fn(),
            saveData: jest.fn(),
            getPreferences: () => ({"startDate": startDate}),
        };

        const scrape = jest.fn().mockReturnValueOnce(Promise.resolve());
        const scrapeWithProvidedDates = provideScrapeDates(scrape);
        scrapeWithProvidedDates();
        expect(scrape).toHaveBeenCalledWith({fromDate: new Date(expectedFromDate), toDate: null});
    });

    it("should save last success date on success", () => {
        const startDate = "2010-01-01T01:01:01.000Z";
        global.ZenMoney = {
            getData: jest.fn(),
            setData: jest.fn(),
            saveData: jest.fn(),
            getPreferences: () => ({"startDate": startDate}),
        };

        const scrape = jest.fn().mockReturnValueOnce(Promise.resolve());
        const scrapeWithProvidedDates = provideScrapeDates(scrape);
        return scrapeWithProvidedDates().then(() => {
            expect(global.ZenMoney.setData).toHaveBeenCalledWith("scrape/lastSuccessDate", expect.any(String));
            expect(global.ZenMoney.saveData).toHaveBeenCalledTimes(1);
        });
    });

    it("should not save last success date on failure", () => {
        const startDate = "2010-01-01T01:01:01.000Z";
        global.ZenMoney = {
            getData: jest.fn(),
            setData: jest.fn(),
            saveData: jest.fn(),
            getPreferences: () => ({"startDate": startDate}),
        };

        const scrape = jest.fn().mockReturnValueOnce(Promise.reject());
        const scrapeWithProvidedDates = provideScrapeDates(scrape);
        return scrapeWithProvidedDates().catch(() => {
            expect(global.ZenMoney.setData).toHaveBeenCalledTimes(0);
            expect(global.ZenMoney.saveData).toHaveBeenCalledTimes(0);
        });
    });
});

describe("postProcessTransactions", () => {
    const processDate = (date) => postProcessTransaction({date}).date;
    const assertIsUntouched = (date) => expect(processDate(date)).toBe(date);

    it("should fix dates if dateProcessing feature is not implemented", () => {
        global.ZenMoney = {features: {}};
        expect(processDate(new Date(2010, 0, 0, 23, 59, 59))).toEqual("2009-12-31");
        expect(processDate(new Date(2010, 0, 1, 0, 0, 0))).toEqual("2010-01-01");
        expect(processDate(new Date(2010, 0, 1, 23, 59, 59))).toEqual("2010-01-01");
        expect(processDate(new Date(2010, 0, 2, 0, 0, 0))).toEqual("2010-01-02");
        assertIsUntouched(Date.now());

        global.ZenMoney = {features: {dateProcessing: true}};
        assertIsUntouched(new Date("2010-01-01T00:00:00+05:00"));
        assertIsUntouched(new Date("2010-01-01T00:00:00-05:00"));
        assertIsUntouched("2010-01-01");
        assertIsUntouched(null);
        assertIsUntouched(undefined);
        assertIsUntouched(Date.now());
    });
});

afterEach(() => {
    delete global.ZenMoney;
});

describe("test suite", () => {
    it("can spoil globals", () => {
        global.ZenMoney = {};
    });

    it("should clean up globals", () => {
        expect(global).not.toHaveProperty("ZenMoney");
    });
});
