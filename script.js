// script.js - FINAL STABLE VERSION WITH BONUS NUMBER LOGIC

document.addEventListener('DOMContentLoaded', () => {
    // --- State Variables and Chart Instances ---
    let historicalData = [], stats = {}, currentGeneratedComboObject = null;
    let savedCombinations = JSON.parse(localStorage.getItem('savedCombinations')) || [];
    let frequencyChart, sumChart, oddEvenChart, highLowChart;

    // --- DOM Elements ---
    const darkModeToggle = document.getElementById('darkModeToggle');
    const historicalDrawsCountEl = document.getElementById('historicalDrawsCount');
    const overdueNumbersDisplay = document.getElementById('overdueNumbersDisplay');
    const deltaPatternsDisplay = document.getElementById('deltaPatternsDisplay');
    const affinityHeatmap = document.getElementById('affinityHeatmap');
    const strongPairsDisplay = document.getElementById('strongPairsDisplay');
    const multipleResultsEl = document.getElementById('multipleResults');
    const combinationHistory = document.getElementById('combinationHistory');
    const modelStatusEl = document.getElementById('modelStatus');
    const useMLCheckbox = document.getElementById('useML');
    const notificationEl = document.getElementById('notification');
    const customStrategyContainer = document.getElementById('customStrategyContainer');
    const generationWorker = new Worker('generation.worker.js');

    // --- Initialization ---
    async function initializeApp() {
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            darkModeToggle.checked = true;
        }

        try {
            const response = await fetch('https://lotto-649-quebec.onrender.com');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            historicalData = await response.json();
            historicalData.reverse(); 
            historicalDrawsCountEl.textContent = historicalData.length;
            stats = Optimizer.analyze(historicalData);
            displayStatistics();
            displaySavedCombinations();
            await checkMLModelStatus();
        } catch (error) {
            console.error("Error connecting to backend:", error);
            showNotification('Could not connect to the backend server. Is it running?', 'error');
        }
    }

    // --- Event Listeners ---
    darkModeToggle.addEventListener('change', function() {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('theme', this.checked ? 'dark' : 'light');
        renderAllCharts();
    });

    document.getElementById('generateButton').addEventListener('click', () => generateNumbers(1));
    document.getElementById('generateMultipleButton').addEventListener('click', () => generateNumbers(5));
    document.getElementById('trainModelButton').addEventListener('click', trainMLModel);
    document.getElementById('saveComboButton').addEventListener('click', () => saveCombination(currentGeneratedComboObject));
    document.getElementById('checkSingleButton').addEventListener('click', checkSingleResult);
    document.getElementById('checkAllButton').addEventListener('click', checkAllSavedResults);
    document.getElementById('clearAllButton').addEventListener('click', clearAllSaved);
    document.getElementById('generateWheelButton').addEventListener('click', generateWheel);
    document.getElementById('refreshDataButton').addEventListener('click', refreshData);
    
    document.querySelectorAll('.tab-button').forEach(tab => tab.addEventListener("click", () => {
        document.querySelector('.tab-button.active').classList.remove('active');
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
        const activeTabContent = document.getElementById(tab.dataset.tab);
        activeTabContent.style.display = 'block';
        renderAllCharts();
    }));

    document.querySelectorAll('.strategy-item').forEach(item => item.addEventListener("click", () => {
        document.querySelector('.strategy-item.active').classList.remove('active');
        item.classList.add('active');
        if (item.dataset.strategy === 'custom') {
            customStrategyContainer.style.display = 'grid';
        } else {
            customStrategyContainer.style.display = 'none';
        }
    }));

    multipleResultsEl.addEventListener('click', function(e) {
        if (e.target.classList.contains('save-multiple-btn')) {
            const button = e.target;
            const comboToSave = JSON.parse(button.dataset.combination);
            saveCombination(comboToSave);
            button.textContent = 'Saved!';
            button.disabled = true;
        }
    });

    combinationHistory.addEventListener('click', function(e) {
        if (e.target.classList.contains('delete-btn')) {
            const indexToDelete = parseInt(e.target.dataset.index, 10);
            deleteSingleCombination(indexToDelete);
        }
    });
    
    generationWorker.onmessage = function(e) {
        const { type, payload } = e.data;
        if (type === 'progress') {
            updateProgressBar(document.getElementById('progressBar'), document.getElementById('progressText'), payload.progress);
        } else if (type === 'result') {
            const { combinations } = payload;
            if (combinations.length === 1) {
                displaySingleCombination(combinations[0]);
            } else {
                displayMultipleCombinations(combinations);
            }
            showProgressBar('progressContainer', false);
        } else if (type === 'error') {
            console.error("Error from worker:", payload);
            showNotification('Error during generation. See console.', 'error');
            showProgressBar('progressContainer', false);
        }
    };

    // --- Core Functions ---
    async function generateNumbers(count) {
        const options = getSelectedOptions();
        if (options.strategy === 'custom') {
            options.customRules = getCustomRules();
        }
        showProgressBar('progressContainer', true);
        let mlPredictions = null;
        if (options.useML) {
            if (await ML_Model.modelExists()) {
                mlPredictions = await ML_Model.predict(historicalData);
                showNotification(mlPredictions ? 'Using ML model for predictions.' : 'Could not generate ML predictions.', mlPredictions ? 'info' : 'warning');
            } else {
                showNotification('ML model not trained. Ignoring ML option.', 'warning');
            }
        }
        generationWorker.postMessage({ type: 'generate', payload: { stats, options, count, historicalData, mlPredictions } });
    }

    async function trainMLModel() {
        if (!useMLCheckbox.checked) {
            showNotification('"Use ML Predictions" must be enabled to train the model.', 'warning');
            return;
        }
        showProgressBar('trainingProgress', true);
        modelStatusEl.textContent = 'Training...';
        try {
            await ML_Model.train(historicalData, (p) => updateProgressBar(document.getElementById('trainingProgressBar'), document.getElementById('trainingProgressText'), p));
            modelStatusEl.textContent = 'Trained';
            showNotification('ML Model trained successfully!', 'success');
        } catch (error) {
            modelStatusEl.textContent = 'Training Failed';
            showNotification('ML Model training failed. See console.', 'error');
        } finally {
            showProgressBar('trainingProgress', false);
        }
    }

    function saveCombination(comboToSave) {
        if (!comboToSave || !comboToSave.numbers || comboToSave.numbers.length === 0) {
            showNotification('Cannot save an invalid combination.', 'error');
            return;
        }
        const isDuplicate = savedCombinations.some(c => JSON.stringify(c.numbers) === JSON.stringify(comboToSave.numbers));
        if (isDuplicate) {
            showNotification('This combination is already saved.', 'warning');
            return;
        }
        savedCombinations.push({
            numbers: comboToSave.numbers,
            confidence: comboToSave.confidence,
            date: new Date().toISOString()
        });
        localStorage.setItem('savedCombinations', JSON.stringify(savedCombinations));
        displaySavedCombinations();
        showNotification('Combination saved!', 'success');
    }
    
    function deleteSingleCombination(index) {
        if (index >= 0 && index < savedCombinations.length) {
            savedCombinations.splice(index, 1);
            localStorage.setItem('savedCombinations', JSON.stringify(savedCombinations));
            displaySavedCombinations();
            showNotification('Combination deleted.', 'info');
        }
    }

    function clearAllSaved() {
        if (savedCombinations.length === 0) {
            showNotification('There are no combinations to delete.', 'info');
            return;
        }
        if (confirm('Are you sure you want to delete ALL saved combinations? This cannot be undone.')) {
            savedCombinations = [];
            localStorage.removeItem('savedCombinations');
            displaySavedCombinations();
            showNotification('All saved combinations have been deleted.', 'info');
        }
    }

    function getLastDraw() {
        if (historicalData.length === 0) {
            showNotification('Historical data not loaded yet.', 'warning');
            return null;
        }
        return historicalData[historicalData.length - 1];
    }

    function checkSingleResult() {
        const lastDraw = getLastDraw();
        if (!lastDraw || !currentGeneratedComboObject) {
            showNotification('Please generate a number set first.', 'warning');
            return;
        }
        const winningNumbers = lastDraw.numbers;
        const winningBonus = lastDraw.bonus;
        const userNumbers = currentGeneratedComboObject.numbers;
        
        const matches = userNumbers.filter(num => winningNumbers.includes(num));
        const bonusMatch = userNumbers.some(num => !matches.includes(num) && num === winningBonus);

        displaySingleCombination(currentGeneratedComboObject, matches, bonusMatch ? winningBonus : null);
        
        let resultText = `Matched ${matches.length}/6.`;
        if (bonusMatch) {
            resultText = `Matched ${matches.length}/6 + Bonus!`;
        }
        document.getElementById('singleDrawInfo').textContent = `Checked against draw on ${new Date(lastDraw.date).toLocaleDateString()}. ${resultText}`;
    }

    function checkAllSavedResults() {
        const lastDraw = getLastDraw();
        if (!lastDraw) return;
        
        const winningNumbers = lastDraw.numbers;
        const winningBonus = lastDraw.bonus;
        
        savedCombinations.forEach(combo => {
            const matches = combo.numbers.filter(num => winningNumbers.includes(num));
            const bonusMatch = combo.numbers.some(num => !matches.includes(num) && num === winningBonus);
            
            combo.lastCheck = { 
                matches: matches, 
                matchCount: matches.length,
                bonusMatch: bonusMatch
            };
        });
        
        displaySavedCombinations();
        document.getElementById('allDrawInfo').textContent = `Checked against draw on ${new Date(lastDraw.date).toLocaleDateString()}: ${winningNumbers.join(', ')} + Bonus ${winningBonus}`;
    }

    function generateWheel() {
        const numbersInput = document.getElementById('wheelNumbersInput').value;
        const wheelType = document.getElementById('wheelGuaranteeSelect').value;
        const numbers = numbersInput.split(/\s+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n > 0 && n < 50);
        
        if (new Set(numbers).size !== numbers.length) {
            showNotification('Please ensure all numbers are unique.', 'warning');
            return;
        }

        let wheeledTickets = [];

        if (wheelType === '3-if-4-in-10') {
            if (numbers.length !== 10) {
                showNotification('This specific wheel requires exactly 10 numbers.', 'warning');
                return;
            }
            const [n1, n2, n3, n4, n5, n6, n7, n8, n9, n10] = numbers.sort((a,b)=>a-b);
            wheeledTickets = [
                [n1, n2, n3, n4, n5, n6],
                [n1, n2, n3, n7, n8, n9],
                [n4, n5, n6, n7, n8, n10]
            ];
            showNotification(`Generated a highly efficient wheel with ${wheeledTickets.length} tickets.`, 'success');
        } else { 
            if (numbers.length < 6 || numbers.length > 15) {
                showNotification('Full wheels work with 6 to 15 numbers.', 'warning');
                return;
            }
            wheeledTickets = getCombinations(numbers, 6);
            if (wheeledTickets.length > 50) {
                showNotification(`This full wheel generates ${wheeledTickets.length} tickets. Showing the first 50.`, 'info');
                wheeledTickets = wheeledTickets.slice(0, 50);
            } else {
                 showNotification(`Generated a full wheel with ${wheeledTickets.length} tickets.`, 'info');
            }
        }
        
        displayWheeledTickets(wheeledTickets);
    }

    async function refreshData() {
        showNotification('Fetching latest data from server...', 'info');
        try {
            const response = await fetch('http://localhost:3000/api/results');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            const newData = await response.json();
            newData.reverse();
            
            if (newData.length > historicalData.length) {
                showNotification(`Success! ${newData.length - historicalData.length} new draw(s) added.`, 'success');
            } else {
                showNotification('Data is already up-to-date.', 'success');
            }

            historicalData = newData;
            historicalDrawsCountEl.textContent = historicalData.length;
            stats = Optimizer.analyze(historicalData);
            
            displayStatistics();
            
        } catch (error) {
            console.error("Error refreshing data:", error);
            showNotification('Could not connect to the backend server.', 'error');
        }
    }

    // --- Display Functions ---
    function displayStatistics() {
        overdueNumbersDisplay.innerHTML = createNumberDivs(stats.overdue);
        deltaPatternsDisplay.innerHTML = stats.deltaPatterns.slice(0, 5).map(p => `[${p.pattern.join(', ')}] - ${p.count} times`).join('<br>');
        displayHeatmap();
        displayStrongPairs();
        renderAllCharts();
    }
    
    function displaySavedCombinations() {
        const container = document.getElementById('combinationHistory');
        if (savedCombinations.length === 0) {
            container.innerHTML = "<p>No combinations saved yet.</p>";
            document.getElementById('allDrawInfo').textContent = '';
            return;
        }
        container.innerHTML = savedCombinations.map((combo, index) => {
            const hasCheckResults = combo.lastCheck !== undefined;
            const lastCheck = combo.lastCheck || {};
            const numbersHtml = createNumberDivs(combo.numbers, 'number', lastCheck.matches, lastCheck.bonusMatch ? getLastDraw()?.bonus : null);
            
            let resultHtml = '';
            if (hasCheckResults) {
                resultHtml = `<span class="match-result">Matched ${lastCheck.matchCount}/6${lastCheck.bonusMatch ? ' + Bonus' : ''}</span>`;
            }

            return `
            <div class="item">
                <div class="numbers-wrapper">${numbersHtml}</div>
                ${resultHtml}
                <span class="saved-confidence">${combo.confidence ? `Conf: ${combo.confidence.toFixed(1)}%` : ''}</span>
                <span>${new Date(combo.date).toLocaleDateString()}</span>
                <button class="delete-btn" data-index="${index}" title="Delete Combination">&times;</button>
            </div>`;
        }).join('');
    }

    function displaySingleCombination(combo, matches = [], bonusMatchNumber = null) {
        if (!combo || !combo.numbers) return;
        currentGeneratedComboObject = combo;
        document.getElementById('numbersContainer').style.display = 'block';
        document.getElementById('multipleResultsContainer').style.display = 'none';
        document.getElementById('generatedNumbers').innerHTML = createNumberDivs(combo.numbers, 'number', matches, bonusMatchNumber);
        document.getElementById('combinationStats').textContent = `Sum: ${combo.sum}, Odd/Even: ${combo.oddEven}, High/Low: ${combo.highLow}`;
        document.getElementById('confidenceLevel').style.width = `${combo.confidence}%`;
        document.getElementById('confidenceScore').textContent = `${combo.confidence.toFixed(2)}%`;
        if (matches.length === 0 && !bonusMatchNumber) {
            document.getElementById('singleDrawInfo').textContent = '';
        }
    }

    function displayMultipleCombinations(combos) {
        const container = document.getElementById('multipleResultsContainer');
        const resultsEl = document.getElementById('multipleResults');
        container.style.display = 'block';
        document.getElementById('numbersContainer').style.display = 'none';
        combos.sort((a, b) => b.confidence - a.confidence);
        resultsEl.innerHTML = combos.map(combo => {
            const isSaved = savedCombinations.some(c => JSON.stringify(c.numbers) === JSON.stringify(combo.numbers));
            return `
            <div class="multiple-result-item">
              <div class="numbers-wrapper">${createNumberDivs(combo.numbers)}</div>
              <span class="stats-text"><b>Confidence: ${combo.confidence.toFixed(2)}%</b> | Sum: ${combo.sum} | O/E: ${combo.oddEven} | H/L: ${combo.highLow}</span>
              <button class="save-multiple-btn" data-combination='${JSON.stringify(combo)}' ${isSaved ? 'disabled' : ''}>${isSaved ? 'Saved!' : 'Save Set'}</button>
            </div>`;
        }).join('');
    }

    function displayWheeledTickets(tickets) {
        const resultsContainer = document.getElementById('wheelResultsContainer');
        const resultsEl = document.getElementById('wheelResults');
        const ticketCountEl = document.getElementById('wheelTicketCount');
        resultsContainer.style.display = 'block';
        ticketCountEl.textContent = tickets.length;
        resultsEl.innerHTML = tickets.map(ticket => {
            return `<div class="multiple-result-item"><div class="numbers-wrapper">${createNumberDivs(ticket)}</div></div>`;
        }).join('');
    }

    // --- CHART RENDERING FUNCTIONS ---
    function renderAllCharts() {
        const activeTab = document.querySelector('.tab-button.active').dataset.tab;
        if (activeTab === 'frequency-analysis') renderFrequencyChart();
        if (activeTab === 'pattern-analysis') {
            renderSumChart();
            renderOddEvenChart();
            renderHighLowChart();
        }
    }
    
    function replaceCanvas(chartId) {
        const container = document.getElementById(chartId).parentElement;
        container.innerHTML = `<canvas id="${chartId}"></canvas>`;
        return container.firstElementChild.getContext('2d');
    }

    function renderFrequencyChart() {
        if (frequencyChart) frequencyChart.destroy();
        const ctx = replaceCanvas('frequencyChart');
        if (!ctx) return;
        const labels = Array.from({ length: 49 }, (_, i) => i + 1);
        const data = stats.frequency.slice(1);
        frequencyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Frequency', data,
                    backgroundColor: labels.map(num => {
                        if (stats.hot.includes(num)) return 'rgba(211, 47, 47, 0.7)';
                        if (stats.cold.includes(num)) return 'rgba(25, 118, 210, 0.7)';
                        return 'rgba(189, 189, 189, 0.7)';
                    }),
                    borderColor: labels.map(num => {
                        if (stats.hot.includes(num)) return '#D32F2F';
                        if (stats.cold.includes(num)) return '#1976D2';
                        return '#BDBDBD';
                    }),
                    borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: { display: true, text: 'Hot (Red) vs. Cold (Blue) Number Frequencies' } } }
        });
    }

    function renderSumChart() {
        if (sumChart) sumChart.destroy();
        const ctx = replaceCanvas('sumChart');
        if (!ctx) return;
        const buckets = {};
        stats.sumRanges.draws.forEach(sum => {
            const bucket = Math.floor(sum / 10) * 10;
            buckets[bucket] = (buckets[bucket] || 0) + 1;
        });
        const sortedKeys = Object.keys(buckets).sort((a, b) => parseInt(a) - parseInt(b));
        sumChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sortedKeys.map(k => `${k}-${parseInt(k) + 9}`),
                datasets: [{ label: 'Number of Draws', data: sortedKeys.map(k => buckets[k]), backgroundColor: 'rgba(54, 162, 235, 0.6)' }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, title: {display: true, text: 'Sum Distribution'} } }
        });
    }

    function renderOddEvenChart() {
        if (oddEvenChart) oddEvenChart.destroy();
        const ctx = replaceCanvas('oddEvenChart');
        if (!ctx) return;
        const sortedData = Object.entries(stats.oddEvenDistribution).sort(([, a], [, b]) => b - a);
        oddEvenChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: sortedData.map(d => d[0]),
                datasets: [{ data: sortedData.map(d => d[1]), backgroundColor: ['#1976D2', '#FFC107', '#64B5F6', '#FFD54F', '#90CAF9', '#FFE082'] }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, title: {display: true, text: 'Odd/Even Distribution'} } }
        });
    }

    function renderHighLowChart() {
        if (highLowChart) highLowChart.destroy();
        const ctx = replaceCanvas('highLowChart');
        if (!ctx) return;
        const sortedData = Object.entries(stats.highLowDistribution).sort(([, a], [, b]) => b - a);
        highLowChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: sortedData.map(d => d[0].replace('H', ' High').replace('L', ' Low')),
                datasets: [{ data: sortedData.map(d => d[1]), backgroundColor: ['#0D47A1', '#FF8F00', '#42A5F5', '#FFB300', '#90CAF9', '#FFD54F'] }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' }, title: {display: true, text: 'High/Low Distribution'} } }
        });
    }
    
    // --- Utility Functions ---
    function getCustomRules() {
        const parseNumbers = (input) => input.split(/\s+/).map(n => parseInt(n.trim())).filter(n => !isNaN(n) && n > 0 && n < 50);
        return {
            sumMin: parseInt(document.getElementById('customSumMin').value) || null,
            sumMax: parseInt(document.getElementById('customSumMax').value) || null,
            include: parseNumbers(document.getElementById('customInclude').value),
            exclude: parseNumbers(document.getElementById('customExclude').value)
        };
    }

    function displayHeatmap() {
        const affinityHeatmap = document.getElementById('affinityHeatmap');
        let maxCount = 0;
        for (const n1 in stats.affinityMatrix) {
            for (const n2 in stats.affinityMatrix[n1]) {
                if (stats.affinityMatrix[n1][n2] > maxCount) {
                    maxCount = stats.affinityMatrix[n1][n2];
                }
            }
        }
        if (maxCount === 0) maxCount = 1;

        affinityHeatmap.innerHTML = "";
        for (let i = 1; i <= 49; i++) {
            for (let j = 1; j <= 49; j++) {
                const cell = document.createElement("div");
                cell.className = "cell";
                if (j > i) {
                    const count = stats.affinityMatrix[i]?.[j] || 0;
                    const opacity = Math.pow(count / maxCount, 0.5);
                    cell.style.backgroundColor = `rgba(13, 71, 161, ${opacity})`;
                    cell.title = `Pair (${i}, ${j}): Appeared together ${count} times`;
                } else {
                    cell.style.backgroundColor = 'transparent';
                    cell.style.border = 'none';
                }
                affinityHeatmap.appendChild(cell);
            }
        }
    }

    function displayStrongPairs() {
        strongPairsDisplay.innerHTML = stats.strongPairs.slice(0, 5).map(p => `(${p.pair.join(", ")}) - ${p.count} times`).join("<br>");
    }

    function createNumberDivs(numbers, className = 'number', matchedNumbers = [], bonusMatchNumber = null) {
        return numbers ? numbers.map(n => {
            const isMainMatch = matchedNumbers && matchedNumbers.includes(n);
            const isBonusMatch = n === bonusMatchNumber;
            let cssClass = '';
            if (isMainMatch) cssClass = 'matched';
            if (isBonusMatch) cssClass = 'matched-bonus';
            return `<div class="${className} ${cssClass}">${n}</div>`;
        }).join('') : '';
    }

    function getCombinations(array, size) {
        const result = [];
        function combination(index, currentCombo) {
            if (currentCombo.length === size) {
                result.push([...currentCombo]);
                return;
            }
            if (index >= array.length) return;
            currentCombo.push(array[index]);
            combination(index + 1, currentCombo);
            currentCombo.pop();
            combination(index + 1, currentCombo);
        }
        combination(0, []);
        return result;
    }

    function getSelectedOptions() {
        const options = {};
        document.querySelectorAll('.options input[type="checkbox"]').forEach(el => options[el.id] = el.checked);
        options.strategy = document.querySelector(".strategy-item.active").dataset.strategy;
        return options;
    }

    async function checkMLModelStatus() {
        const modelExists = await ML_Model.modelExists();
        modelStatusEl.textContent = modelExists ? 'Trained' : 'Not Trained';
        modelStatusEl.style.color = modelExists ? 'var(--success-color)' : 'var(--warning-color)';
    }

    function showProgressBar(id, show) {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? 'block' : 'none';
    }

    function updateProgressBar(bar, text, progress) {
        if (bar) bar.style.width = `${progress}%`;
        if (text) text.textContent = `Processing ${progress.toFixed(0)}%`;
    }

    function showNotification(message, type = 'info') {
        notificationEl.textContent = message;
        notificationEl.style.backgroundColor = type === 'error' ? 'var(--warning-color)' : (type === 'warning' ? 'var(--accent-color)' : 'var(--primary-color)');
        notificationEl.style.display = 'block';
        setTimeout(() => {
            notificationEl.style.display = 'none';
        }, 4000);
    }

    initializeApp();
});
