// optimizer.js - ENTIRE FILE

const Optimizer = {
    analyze(data) {
        // ... (no changes in the first part of the function)
        const frequency = new Array(50).fill(0);
        const lastSeen = new Array(50).fill(data.length);
        const affinityMatrix = {};
        const sumRanges = { common: { min: 150, max: 250 }, draws: [] };
        const oddEvenDistribution = {};
        const highLowDistribution = {};
        const deltaPatterns = {};

        data.forEach((draw, index) => {
            const numbers = draw.numbers.sort((a, b) => a - b);
            let sum = 0;
            let oddCount = 0;
            let highCount = 0;

            numbers.forEach(num => {
                frequency[num]++;
                lastSeen[num] = index;
                sum += num;
                if (num % 2 !== 0) oddCount++;
                if (num > 24) highCount++;
            });
            
            for (let i = 0; i < numbers.length; i++) {
                for (let j = i + 1; j < numbers.length; j++) {
                    const n1 = numbers[i], n2 = numbers[j];
                    affinityMatrix[n1] = affinityMatrix[n1] || {};
                    affinityMatrix[n1][n2] = (affinityMatrix[n1][n2] || 0) + 1;
                }
            }

            sumRanges.draws.push(sum);
            const oddEvenKey = `${oddCount}O/${6 - oddCount}E`;
            oddEvenDistribution[oddEvenKey] = (oddEvenDistribution[oddEvenKey] || 0) + 1;
            const highLowKey = `${highCount}H/${6 - highCount}L`;
            highLowDistribution[highLowKey] = (highLowDistribution[highLowKey] || 0) + 1;

            const deltas = numbers.slice(1).map((n, i) => n - numbers[i]);
            const deltaKey = JSON.stringify(deltas);
            deltaPatterns[deltaKey] = (deltaPatterns[deltaKey] || 0) + 1;
        });

        const sortedFreq = frequency.map((count, num) => ({ num, count })).slice(1).sort((a, b) => b.count - a.count);
        const hot = sortedFreq.slice(0, 10).map(item => item.num);
        const cold = sortedFreq.slice(-10).map(item => item.num);

        const overdue = lastSeen.map((seenIndex, num) => ({ num, gap: data.length - seenIndex }))
            .slice(1).sort((a, b) => b.gap - a.gap).slice(0, 10).map(item => item.num);
            
        const strongPairs = [];
        for (const n1 in affinityMatrix) {
            for (const n2 in affinityMatrix[n1]) {
                strongPairs.push({ pair: [parseInt(n1), parseInt(n2)], count: affinityMatrix[n1][n2] });
            }
        }
        strongPairs.sort((a, b) => b.count - a.count);

        return {
            frequency,
            lastSeen,
            hot,
            cold,
            overdue,
            affinityMatrix,
            strongPairs: strongPairs.slice(0, 10), // Return top 10 strong pairs
            sumRanges: { common: {min: 115, max: 215}, draws: sumRanges.draws },
            oddEvenDistribution,
            highLowDistribution,
            deltaPatterns: Object.entries(deltaPatterns).map(([pattern, count]) => ({ pattern: JSON.parse(pattern), count }))
                .sort((a, b) => b.count - a.count).slice(0, 10), // Return top 10 delta patterns
        };
    }
};