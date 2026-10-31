// script.js - FINAL STABLE AND CLEAN VERSION

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
    const downloadModelButton = document.getElementById('downloadModelButton');
    const uploadModelInput = document.getElementById('uploadModelInput');

    let prizeWorker = null, prizeGroup = null, prizeOptions = null;
    const prizeBudget = document.getElementById('prizeBudget');
    const prizeSeed = document.getElementById('prizeSeed');
    const prizeGenerate = document.getElementById('generatePrizeTicketsButton');
    const backtestButton = document.getElementById('runBacktestButton');
    const cancelBacktest = document.getElementById('cancelBacktestButton');
    const prizeProgress = document.getElementById('prizeProgress');
    const progressMeter = document.getElementById('backtestProgress');

    function finishPrizeWork() {
        if (prizeWorker) prizeWorker.terminate();
        prizeWorker = null;
        prizeGenerate.disabled = false;
        backtestButton.disabled = !prizeGroup;
        cancelBacktest.hidden = true;
        progressMeter.hidden = true;
        document.getElementById('refreshDataButton').disabled = false;
    }
    function invalidatePrizeGroup() {
        finishPrizeWork();
        prizeGroup = null;
        backtestButton.disabled = true;
        document.getElementById('prizeResults').innerHTML = '';
        document.getElementById('backtestDashboard').innerHTML = '';
        try {
            document.getElementById('prizeTicketCount').textContent = PrizeOptimizer.ticketCountFromBudget(Number(prizeBudget.value));
            prizeBudget.setCustomValidity('');
            prizeProgress.textContent = 'Generate a group with these settings.';
        } catch (error) {
            document.getElementById('prizeTicketCount').textContent = '—';
            prizeBudget.setCustomValidity(error.message);
            prizeProgress.textContent = error.message;
        }
    }
    function startPrizeWork(type, payload) {
        finishPrizeWork();
        prizeGenerate.disabled = backtestButton.disabled = true;
        cancelBacktest.hidden = false;
        document.getElementById('refreshDataButton').disabled = true;
        prizeProgress.textContent = type === 'generate' ? 'Searching ticket-group coverage…' : 'Starting full-history replay after 100 warmup draws…';
        document.getElementById('backtestDashboard').innerHTML = '';
        try {
            const worker = prizeWorker = new Worker('backtest.worker.js');
            prizeWorker.onmessage = ({ data }) => {
                if (prizeWorker !== worker) return;
                if (data.type === 'progress') {
                    const { phase, completed, total } = data.payload;
                    progressMeter.hidden = false;
                    progressMeter.value = total ? completed / total * 100 : 0;
                    prizeProgress.textContent = `${phase}: ${completed.toLocaleString()} / ${total.toLocaleString()} draw evaluations. The page remains usable.`;
                } else if (data.type === 'tickets') {
                    prizeGroup = data.payload;
                    renderPrizeOptimization(prizeGroup);
                    prizeProgress.textContent = 'Ticket group ready. Run the comparison to evaluate the strategy across all eligible history.';
                    finishPrizeWork();
                } else if (data.type === 'result') {
                    renderBacktestDashboard(data.payload);
                    prizeProgress.textContent = 'Full-history comparison complete. Financial fields use complete payout records only.';
                    finishPrizeWork();
                } else if (data.type === 'error') {
                    prizeProgress.textContent = `Calculation failed: ${data.payload.message}`;
                    finishPrizeWork();
                }
            };
            prizeWorker.onerror = () => { if (prizeWorker !== worker) return; prizeProgress.textContent = 'Worker failed to load or calculate. Retry on an HTTP server.'; finishPrizeWork(); };
            prizeWorker.postMessage({ type, payload });
        } catch (error) { prizeProgress.textContent = error.message; finishPrizeWork(); }
    }
    prizeBudget.addEventListener('input', invalidatePrizeGroup);
    prizeSeed.addEventListener('input', invalidatePrizeGroup);
    document.querySelectorAll('[name="prizeStrategy"]').forEach(radio => radio.addEventListener('change', invalidatePrizeGroup));
    prizeGenerate.addEventListener('click', () => {
        if (!prizeBudget.reportValidity() || !prizeSeed.reportValidity()) return;
        const seed = Number(prizeSeed.value);
        if (!Number.isSafeInteger(seed)) { prizeProgress.textContent = 'Seed must be a safe integer.'; return; }
        prizeOptions = { strategy: document.querySelector('[name="prizeStrategy"]:checked').value, budget: Number(prizeBudget.value), seed };
        startPrizeWork('generate', prizeOptions);
    });
    backtestButton.addEventListener('click', () => {
        if (!historicalData.length) { prizeProgress.textContent = 'Load published history using refresh before running the comparison.'; return; }
        startPrizeWork('backtest', { ...prizeOptions, draws: historicalData, tickets: prizeGroup.tickets });
    });
    cancelBacktest.addEventListener('click', () => { finishPrizeWork(); prizeProgress.textContent = 'Calculation cancelled. No partial result is shown.'; });

    // --- Initialization ---
    async function initializeApp() {
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
            darkModeToggle.checked = true;
        }
        updateModelStatus(false, 'No Model Loaded');
        try {
            await loadPublishedData();
            displaySavedCombinations();
        } catch (error) {
            renderDataStatus({ state: "unavailable", message: "Published history/status could not be loaded. Retry refresh." });
            console.error("Error loading published snapshots:", error);
            showNotification('Could not load published history/status. Serve this page over HTTP and retry refresh.', 'error');
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
    document.getElementById('useOverdueForWheelButton').addEventListener('click', useOverdueForWheel);
    
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
    
    uploadModelInput.addEventListener('change', async function(e) {
        const files = e.target.files;
        if (!files || files.length !== 2) {
            showNotification('Please select both the model.json and model.weights.bin files.', 'error');
            return;
        }
        const jsonFile = Array.from(files).find(file => file.name.endsWith('.json'));
        const weightsFile = Array.from(files).find(file => file.name.endsWith('.bin'));

        if (!jsonFile || !weightsFile) {
            showNotification('Both .json and .bin files are required.', 'error');
            return;
        }
        try {
            ML_Model.model = await tf.loadLayersModel(tf.io.browserFiles([jsonFile, weightsFile]));
            updateModelStatus(true, 'Model Loaded');
            showNotification('Model loaded successfully!', 'success');
        } catch (error) {
            console.error("Error loading model:", error);
            updateModelStatus(false, 'Failed to load model.');
            showNotification('Failed to load model files.', 'error');
        }
    });

    downloadModelButton.addEventListener('click', async () => {
        if (ML_Model.model) {
            await ML_Model.model.save('downloads://my-lotto-model');
            showNotification('Model files downloaded!', 'success');
        } else {
            showNotification('No model is currently trained to download.', 'warning');
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
            if (ML_Model.model) {
                mlPredictions = await ML_Model.predict(historicalData);
                showNotification('Using descriptive ML model output; this does not predict draws.', 'info');
            } else {
                showNotification('ML model not loaded. Ignoring ML option.', 'warning');
            }
        }
        generationWorker.postMessage({ type: 'generate', payload: { stats, options, count, historicalData, mlPredictions } });
    }

    async function trainMLModel() {
        if (!useMLCheckbox.checked) {
            showNotification('"Use ML Model Output" must be enabled to train the model.', 'warning');
            return;
        }
        showProgressBar('trainingProgress', true);
        updateModelStatus(false, 'Training...');
        downloadModelButton.style.display = 'none';
        try {
            const trainedModel = await ML_Model.train(historicalData, (p) => updateProgressBar(document.getElementById('trainingProgressBar'), document.getElementById('trainingProgressText'), p));
            if (trainedModel) {
                ML_Model.model = trainedModel;
                updateModelStatus(true, 'Model Trained');
                downloadModelButton.style.display = 'inline-block';
                showNotification('Training complete! Click "Download Model" to save it.', 'success');
            } else {
                throw new Error("Training did not return a valid model.");
            }
        } catch (error) {
            console.error("ML Model training failed:", error);
            updateModelStatus(false, 'Training Failed');
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
    
    function useOverdueForWheel() {
        if (stats && stats.overdue) {
            const overdueNumbers = stats.overdue.slice(0, 10).join(' ');
            document.getElementById('wheelNumbersInput').value = overdueNumbers;
            showNotification('Overdue numbers have been populated.', 'info');
        } else {
            showNotification('Statistics not available yet. Please wait a moment.', 'warning');
        }
    }

    async function loadPublishedData() {
        const [historyResponse, statusResponse] = await Promise.all([
            fetch('historical_data.json', { cache: 'no-store' }),
            fetch('data-status.json', { cache: 'no-store' })
        ]);
        if (!historyResponse.ok || !statusResponse.ok) throw new Error('Published snapshot unavailable');
        const [draws, status] = await Promise.all([historyResponse.json(), statusResponse.json()]);
        if (!Array.isArray(draws) || !draws.length || draws.some(draw => !PrizeEngine.normalizeDraw(draw))) throw new Error('Invalid published history');
        if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('Invalid published status');
        historicalData = draws.slice().sort((a, b) => a.date.localeCompare(b.date));
        historicalDrawsCountEl.textContent = historicalData.length;
        stats = Optimizer.analyze(historicalData);
        renderDataStatus(status);
        displayStatistics();
    }

    async function refreshData() {
        const button = document.getElementById('refreshDataButton');
        button.disabled = true;
        showNotification('Reloading published history and import status…', 'info');
        try {
            await loadPublishedData();
            document.getElementById('backtestDashboard').innerHTML = '';
            showNotification('Published snapshots reloaded. This does not check the official website.', 'success');
        } catch (error) {
            document.getElementById('dataStatus').textContent = 'Reload failed. Previous local history is retained; published status could not be verified.';
            showNotification('Could not reload published snapshots. Please retry.', 'error');
        } finally { button.disabled = false; }
    }

    // --- Display Functions ---
    function displayStatistics() {
        document.getElementById('overdueNumbersDisplay').innerHTML = createNumberDivs(stats.overdue);
        document.getElementById('deltaPatternsDisplay').innerHTML = stats.deltaPatterns.slice(0, 5).map(p => `[${p.pattern.join(', ')}] - ${p.count} times`).join('<br>');
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
                <span class="saved-confidence">${combo.confidence ? `Score: ${combo.confidence.toFixed(1)} / 100` : ''}</span>
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
        document.getElementById('confidenceScore').textContent = `${combo.confidence.toFixed(2)} / 100`;
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
              <span class="stats-text"><b>Model / heuristic score: ${combo.confidence.toFixed(2)} / 100</b> | Sum: ${combo.sum} | O/E: ${combo.oddEven} | H/L: ${combo.highLow}</span>
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
        if (typeof Chart === 'undefined' || !historicalData.length) return;
        const activeTab = document.querySelector('.tab-button.active')?.dataset.tab;
        if (activeTab === 'frequency-analysis') renderFrequencyChart();
        if (activeTab === 'pattern-analysis') {
            renderSumChart();
            renderOddEvenChart();
            renderHighLowChart();
        }
    }
    
    function replaceCanvas(chartId) {
        const container = document.getElementById(chartId)?.parentElement;
        if (!container) return null;
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

    function updateModelStatus(isTrained, message) {
        modelStatusEl.textContent = message;
        modelStatusEl.style.color = isTrained ? 'var(--success-color)' : 'var(--warning-color)';
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
// Rendering is separate from calculation so missing payouts cannot become zero returns.
function prizeEscape(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
function prizeMoney(value) {
    return value == null ? 'Unavailable — incomplete payout history' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value);
}
function prizeRate(value) {
    return value.percentage == null ? 'Unavailable — no eligible denominator' : `${value.percentage.toFixed(2)}% (${value.numerator.toLocaleString()} / ${value.denominator.toLocaleString()})`;
}
function prizeMetrics(entries) {
    return `<dl class="prize-metrics">${entries.map(([label, value]) => `<div><dt>${prizeEscape(label)}</dt><dd>${prizeEscape(value)}</dd></div>`).join('')}</dl>`;
}
function prizeStrategyName(strategy) {
    return { frequent: 'Frequent Wins', return: 'Return analysis (Maximum Return)', balanced: 'Balanced', 'quick-pick': 'Quick Pick' }[strategy] || strategy;
}
function renderPrizeOptimization(result) {
    const c = result.coverage;
    document.getElementById('prizeResults').innerHTML = `<h3>${prizeEscape(prizeStrategyName(result.strategy))} ticket group</h3>
        <h4>Coverage of this generated group</h4>${prizeMetrics([
            ['Tickets', result.ticketCount], ['Group spending', prizeMoney(result.ticketCount * 3)],
            ['Unique numbers', c.uniqueNumbers], ['Unique pairs', `${c.uniquePairs} / ${c.totalPairs}`],
            ['Duplicate pairs', c.duplicatePairs], ['Unique triplets', `${c.uniqueTriplets} / ${c.totalTriplets}`], ['Duplicate triplets', c.duplicateTriplets]
        ])}<details open><summary>Generated tickets (${result.ticketCount})</summary><ol class="prize-ticket-list">${result.tickets.map(ticket => `<li>${ticket.map(number => `<span>${number}</span>`).join(' ')}</li>`).join('')}</ol></details>`;
}
function renderBacktestDashboard(summary) {
    const { strategy, baseline, simulation } = summary;
    const metrics = result => [
        ['Spending (complete records)', prizeMoney(result.spending)], ['Gross return', prizeMoney(result.grossReturn)],
        ['Net return', prizeMoney(result.netReturn)], ['Free Plays (all evaluated tickets)', result.freePlays],
        ['Prize rate (all tickets)', prizeRate(result.prizeRate)], ['$10+ cash rate (complete-record tickets)', prizeRate(result.cashWin10PlusRate)],
        ['Break-even rate (complete draws)', prizeRate(result.breakEvenRate)],
        ['Outcome distribution (loss / exact break-even / profit)', result.outcomeDistribution.denominator ?
            `${result.outcomeDistribution.loss} / ${result.outcomeDistribution.breakEven} / ${result.outcomeDistribution.profit} of ${result.outcomeDistribution.denominator} complete draws` : 'Unavailable — no complete payout records']
    ];
    document.getElementById('backtestDashboard').innerHTML = `<h3>Historical strategy comparison</h3>
        <p>New tickets are generated before every evaluated draw; this is a replay of the strategy, not a test of the fixed group above. Quick Pick uses the same budget, seed schedule, and dates without coverage search. Results describe past outcomes and do not predict future draws.</p>
        ${prizeMetrics([
            ['Evaluated date range', strategy.dateRange.start ? `${strategy.dateRange.start} to ${strategy.dateRange.end}` : 'No eligible draws'],
            ['Seed', strategy.seed], ['Budget per draw', prizeMoney(strategy.budget)], ['Tickets per draw', strategy.ticketsPerDraw],
            ['Evaluated draws', strategy.evaluatedDrawCount], ['Complete financial draws', strategy.financialDrawCount],
            ['Warmup draws excluded', strategy.excludedWarmupDrawCount], ['Invalid draws excluded', strategy.invalidDrawCount],
            ['Incomplete payouts excluded from financial metrics', strategy.incompletePayoutDrawCount]
        ])}
        <p class="prize-notice">${strategy.incompletePayoutDrawCount ? 'Incomplete payout history: dollar totals and cash/break-even rates exclude these draws. When no complete records exist, financial results are unavailable, not zero.' : 'All evaluated records have complete payouts.'} Free Plays count as $3 in complete-record returns. Gold Ball is excluded. Prize rate counts any Classic prize, including Free Plays.</p>
        <div class="prize-comparison"><section><h4>${prizeEscape(prizeStrategyName(strategy.strategy))}</h4>${prizeMetrics(metrics(strategy))}</section>
        <section><h4>Equal-budget Quick Pick baseline</h4>${prizeMetrics(metrics(baseline))}</section></div>
        <h4>Fair-draw simulation of the generated group</h4>${simulation ? `<p>10,000 independent fair draws, seed ${prizeEscape(simulation.seed)}. Uses the recorded payout table from ${prizeEscape(simulation.scenarioDate)} as a fixed scenario, not a forecast or historical payout replacement.</p>${prizeMetrics(metrics(simulation))}` : '<p>Unavailable — no complete recorded payout table is available for a disclosed financial scenario.</p>'}`;
}
function renderDataStatus(status) {
    const timestamp = value => value ? String(value) : 'Not published';
    const checkedTime = Date.parse(status.lastSuccessAt);
    const stale = !Number.isFinite(checkedTime) || Date.now() - checkedTime > 4 * 86400000;
    document.getElementById('dataStatus').innerHTML = `<strong>Published data · Loto-Québec official source</strong>
        <p>${prizeEscape(status.state || 'Unknown')} · ${stale ? 'Stale / not recently verified' : 'Recently verified publication'} (stale after 4 days without a successful check).</p>
        ${prizeMetrics([['Latest published draw', timestamp(status.latestDrawDate)], ['Last published check', timestamp(status.lastAttemptAt)],
            ['Last successful check', timestamp(status.lastSuccessAt)], ['Last imported draw timestamp', timestamp(status.lastImportedAt)]])}
        <p>${prizeEscape(status.message)}</p><p>Refresh reloads published files only. Failed publisher runs retain the last verified snapshot and timestamps. See the publishing workflow for failure diagnostics.</p>
        <a href="https://loteries.lotoquebec.com/en/lotteries/lotto-6-49-resultats" target="_blank" rel="noopener noreferrer">Official Lotto 6/49 results</a>`;
}
