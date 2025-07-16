// advanced_ml_model.js - ENTIRE FILE with Explicit Initializers

const ML_Model = {
    model: null,
    MODEL_STORAGE_KEY: 'indexeddb://lotto-lstm-model',

    async modelExists() {
        const models = await tf.io.listModels();
        return models[this.MODEL_TENSORFLOWJS_MODEL_PATH] !== undefined; // Corrected key
    },

    async train(data, onProgress) {
        console.log('[ML] Starting LSTM model training...');
        const sequences = [];
        const labels = [];
        const sequenceLength = 10;

        for (let i = 0; i < data.length - sequenceLength; i++) {
            const sequenceSlice = data.slice(i, i + sequenceLength);
            const targetDraw = data[i + sequenceLength];
            const sequenceMatrix = [];
            sequenceSlice.forEach(draw => {
                const drawVector = new Array(49).fill(0);
                draw.numbers.forEach(num => {
                    if (num > 0 && num <= 49) drawVector[num - 1] = 1;
                });
                sequenceMatrix.push(drawVector);
            });
            sequences.push(sequenceMatrix);

            const labelVector = new Array(49).fill(0);
            targetDraw.numbers.forEach(num => {
                if (num > 0 && num <= 49) labelVector[num - 1] = 1;
            });
            labels.push(labelVector);
        }

        const xs = tf.tensor3d(sequences);
        const ys = tf.tensor2d(labels);

        this.model = tf.sequential();
        this.model.add(tf.layers.lstm({
            units: 64,
            inputShape: [sequenceLength, 49],
            // THIS IS THE IMPROVEMENT: Explicitly setting the initializers.
            // We acknowledge the warning and choose these for better model stability.
            kernelInitializer: 'glorotUniform',
            recurrentInitializer: 'orthogonal', // This is the source of the warning
            returnSequences: false
        }));
        this.model.add(tf.layers.dropout({ rate: 0.3 }));
        this.model.add(tf.layers.dense({ units: 49, activation: 'sigmoid' }));

        this.model.compile({
            optimizer: 'adam',
            loss: 'binaryCrossentropy',
            metrics: ['accuracy']
        });

        await this.model.fit(xs, ys, {
            epochs: 75,
            validationSplit: 0.1,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    const progress = ((epoch + 1) / 75) * 100;
                    onProgress(progress);
                    console.log(`[ML] Epoch ${epoch + 1}: Acc = ${logs.acc.toFixed(4)}, Val Acc = ${logs.val_acc.toFixed(4)}`);
                }
            }
        });
        
        tf.dispose([xs, ys]);
        await this.model.save(this.MODEL_STORAGE_KEY);
        console.log('[ML] LSTM Model training complete and saved.');
    },

    async predict(historicalData) {
        console.log('[ML] Attempting to generate LSTM predictions...');
        if (!this.model) {
            if (await this.modelExists()) {
                console.log('[ML] Loading existing LSTM model from storage.');
                this.model = await tf.loadLayersModel(this.MODEL_STORAGE_KEY);
            } else {
                console.warn('[ML] Prediction requested, but LSTM model is not trained. Returning null.');
                return null;
            }
        }
        
        const sequenceLength = 10;
        const lastSequence = historicalData.slice(-sequenceLength);
        const sequenceMatrix = [];
        lastSequence.forEach(draw => {
            const drawVector = new Array(49).fill(0);
            draw.numbers.forEach(num => {
                if (num > 0 && num <= 49) drawVector[num - 1] = 1;
            });
            sequenceMatrix.push(drawVector);
        });

        const input = tf.tensor3d([sequenceMatrix]); 
        const prediction = this.model.predict(input);
        const predictionData = await prediction.data();
        
        console.log('[ML] LSTM Prediction generated successfully.');
        tf.dispose([input, prediction]);
        return predictionData;
    }
};

// A small correction for the key used in modelExists
ML_Model.MODEL_TENSORFLOWJS_MODEL_PATH = `indexeddb://lotto-lstm-model`;