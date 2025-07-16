// generation.worker.js - ENTIRE CLEANED AND CORRECTED FILE

const POPULATION_SIZE = 150;
const GENERATIONS = 80;
const MUTATION_RATE = 0.05;
const ELITISM_COUNT = 2;

const STRATEGY_WEIGHTS = {
    balanced:     { sum: 1.0, oddEven: 1.0, highLow: 1.0, decades: 1.0, hot: 1.0, cold: 0.5, overdue: 1.0 },
    aggressive:   { sum: 0.7, oddEven: 0.8, highLow: 0.8, decades: 0.7, hot: 1.5, cold: 0.2, overdue: 1.5 },
    conservative: { sum: 1.2, oddEven: 1.2, highLow: 1.2, decades: 1.2, hot: 0.5, cold: 0.8, overdue: 0.8 },
    experimental: { sum: 0.8, oddEven: 0.8, highLow: 0.8, decades: 0.8, hot: 0.2, cold: 1.5, overdue: 1.2 }
};


self.onmessage = function(e) {
    try {
        const { type, payload } = e.data;
        if (type === 'generate') {
            const { stats, options, count, mlPredictions } = payload;
            const combinations = runGeneticAlgorithm(stats, options, mlPredictions, count);
            self.postMessage({ type: 'result', payload: { combinations } });
        }
    } catch (error) {
        console.error('Error in generation.worker.js:', error);
        self.postMessage({ type: 'error', payload: { message: error.message } });
    }
};

function runGeneticAlgorithm(stats, options, mlPredictions, count = 1) {
    let population = createInitialPopulation(stats, options, mlPredictions);

    for (let i = 0; i < GENERATIONS; i++) {
        let scoredPopulation = population.map(individual => {
            return calculateConfidence(individual, stats, mlPredictions, options.strategy, options.customRules);
        });
        
        scoredPopulation.sort((a, b) => b.confidence - a.confidence);
        
        let newPopulation = [];
        for (let j = 0; j < ELITISM_COUNT; j++) {
            newPopulation.push(scoredPopulation[j].numbers);
        }

        while (newPopulation.length < POPULATION_SIZE) {
            let parent1 = tournamentSelection(scoredPopulation).numbers;
            let parent2 = tournamentSelection(scoredPopulation).numbers;
            let child = crossover(parent1, parent2, options.customRules);
            mutate(child, options.customRules);
            newPopulation.push(child);
        }
        population = newPopulation;
        
        self.postMessage({ type: 'progress', payload: { progress: ((i + 1) / GENERATIONS) * 100 } });
    }

    let finalScoredPopulation = population.map(individual => calculateConfidence(individual, stats, mlPredictions, options.strategy, options.customRules));
    finalScoredPopulation.sort((a, b) => b.confidence - a.confidence);
    
    const uniqueResults = [];
    const seenCombinations = new Set();

    for (const combo of finalScoredPopulation) {
        const comboKey = JSON.stringify(combo.numbers);
        if (!seenCombinations.has(comboKey)) {
            seenCombinations.add(comboKey);
            uniqueResults.push(combo);
        }
    }

    return uniqueResults.slice(0, count);
}


function calculateConfidence(numbers, stats, mlPredictions, strategy = 'balanced', customRules = null) {
    numbers.sort((a, b) => a - b);
    
    if (strategy === 'custom' && customRules) {
        const sum = numbers.reduce((a, b) => a + b, 0);
        if (customRules.sumMin && sum < customRules.sumMin) return { confidence: 0, numbers };
        if (customRules.sumMax && sum > customRules.sumMax) return { confidence: 0, numbers };
        for (const num of customRules.include) {
            if (!numbers.includes(num)) return { confidence: 0, numbers };
        }
    }

    let score = 0;
    const MAX_SCORE = 100;
    const weights = STRATEGY_WEIGHTS[strategy] || STRATEGY_WEIGHTS.balanced;
    const sum = numbers.reduce((a, b) => a + b, 0);
    const oddCount = numbers.filter(n => n % 2 !== 0).length;
    const highCount = numbers.filter(n => n > 24).length;

    score += Math.max(0, 20 - (Math.abs(sum - 175) / 4)) * (weights.sum || 1);
    if (oddCount === 3) score += 15 * (weights.oddEven || 1); else if (oddCount === 2 || oddCount === 4) score += 10 * (weights.oddEven || 1);
    if (highCount === 3) score += 15 * (weights.highLow || 1); else if (highCount === 2 || highCount === 4) score += 10 * (weights.highLow || 1);
    
    const decades = new Set(numbers.map(n => Math.floor((n - 1) / 10)));
    if (decades.size >= 4) score += 15 * (weights.decades || 1); else if (decades.size === 3) score += 5 * (weights.decades || 1);

    const deltas = numbers.slice(1).map((n, i) => n - numbers[i]);
    const deltaIndex = stats.deltaPatterns.findIndex(p => JSON.stringify(p.pattern) === JSON.stringify(deltas));
    if (deltaIndex !== -1) score += Math.max(0, 10 - deltaIndex);

    let pairScore = 0;
    for(let i=0; i < numbers.length; i++) for (let j=i+1; j < numbers.length; j++) {
        const pairIndex = stats.strongPairs.findIndex(p => p.pair.includes(numbers[i]) && p.pair.includes(numbers[j]));
        if(pairIndex !== -1) pairScore += Math.max(0, 4 - pairIndex);
    }
    score += Math.min(10, pairScore);

    numbers.forEach(num => {
        if(stats.hot.includes(num)) score += 1.0 * (weights.hot || 1);
        if(stats.cold.includes(num)) score += 1.0 * (weights.cold || 1);
        if(stats.overdue.includes(num)) score += 1.0 * (weights.overdue || 1);
    });

    if (mlPredictions) {
        const avgProb = numbers.reduce((acc, num) => acc + (mlPredictions[num - 1] || 0), 0) / 6;
        score += avgProb * 15;
    }
    
    let consecutivePairs = 0;
    for (let i = 0; i < numbers.length - 1; i++) if (numbers[i+1] === numbers[i] + 1) consecutivePairs++;
    score -= consecutivePairs * 7;

    const finalConfidence = Math.max(0, Math.min(100, (score / (MAX_SCORE + 20)) * 100));

    return { numbers, sum, oddEven: `${oddCount}O/${6-oddCount}E`, highLow: `${highCount}H/${6-highCount}L`, confidence: finalConfidence };
}


function createInitialPopulation(stats, options, mlPredictions) {
    let population = [];
    const weights = getNumberWeights(stats, options, mlPredictions);
    for (let i = 0; i < POPULATION_SIZE; i++) {
        population.push(generateWeightedRandom(weights, 6, options.customRules));
    }
    return population;
}
function tournamentSelection(scoredPopulation) {
    const tournamentSize = 5;
    let best = null;
    for(let i = 0; i < tournamentSize; i++) {
        let randomIndividual = scoredPopulation[Math.floor(Math.random() * scoredPopulation.length)];
        if (best === null || randomIndividual.confidence > best.confidence) {
            best = randomIndividual;
        }
    }
    return best;
}
function crossover(parent1, parent2, customRules = null) {
    const included = customRules?.include || [];
    let child = [...included];
    const combined = [...new Set([...parent1, ...parent2])];
    for (const num of combined) {
        if (child.length < 6 && !child.includes(num)) child.push(num);
    }
    const excluded = customRules?.exclude || [];
    while (child.length < 6) {
        let randomNum = Math.floor(Math.random() * 49) + 1;
        if (!child.includes(randomNum) && !excluded.includes(randomNum)) child.push(randomNum);
    }
    return child.sort((a,b) => a-b);
}
function mutate(individual, customRules = null) {
    const included = customRules?.include || [];
    const excluded = customRules?.exclude || [];
    for (let i = 0; i < individual.length; i++) {
        if (included.includes(individual[i])) continue;
        if (Math.random() < MUTATION_RATE) {
            let newNum;
            do {
                newNum = Math.floor(Math.random() * 49) + 1;
            } while (individual.includes(newNum) || excluded.includes(newNum));
            individual[i] = newNum;
        }
    }
}
function getNumberWeights(stats, options, mlPredictions) {
    const weights = new Array(50).fill(1.0);
    if (options.useML && mlPredictions) {
        for(let i=1; i < 50; i++) weights[i] = 0.1 + (mlPredictions[i-1] * 2);
    }
    if (options.favorHot) stats.hot.forEach(num => weights[num] += 0.5);
    if (options.favorCold) stats.cold.forEach(num => weights[num] += 0.5);
    if (options.includeOverdue) stats.overdue.forEach(num => weights[num] += 0.4);
    return weights;
}
function generateWeightedRandom(weights, count, customRules = null) {
    const included = customRules?.include || [];
    const excluded = customRules?.exclude || [];
    let numbers = [...included];
    const weightedPool = [];
    for (let i = 1; i < weights.length; i++) {
        if (excluded.includes(i) || included.includes(i)) continue;
        const weight = Math.max(0, Math.round(weights[i] * 10));
        for (let j = 0; j < weight; j++) weightedPool.push(i);
    }
    while (numbers.length < count && weightedPool.length > 0) {
        const randomIndex = Math.floor(Math.random() * weightedPool.length);
        const number = weightedPool[randomIndex];
        if (!numbers.includes(number)) numbers.push(number);
        for (let k = weightedPool.length - 1; k >= 0; k--) if (weightedPool[k] === number) weightedPool.splice(k, 1);
    }
    while (numbers.length < count) {
        const randomNum = Math.floor(Math.random() * 49) + 1;
        if (!numbers.includes(randomNum) && !excluded.includes(randomNum)) numbers.push(randomNum);
    }
    return numbers.sort((a,b) => a-b);
}