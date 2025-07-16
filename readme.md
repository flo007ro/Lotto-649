# Ultimate Lotto 6/49 Quebec Optimizer

This is a full-stack, AI-powered web application designed to provide advanced statistical analysis and intelligent number generation for the Loto-Québec 6/49 lottery. The application uses historical data, a custom genetic algorithm, and a machine learning model to help users select statistically optimized lottery combinations.

---

## Core Features

*   **Live Data Feed:** A Node.js backend automatically scrapes the official Loto-Québec website for the latest draw results, ensuring the historical data is always up-to-date.
*   **Genetic Algorithm for Number Generation:** Instead of simple random selection, the application uses a genetic algorithm to "evolve" populations of number sets over many generations to find combinations with the highest statistical "fitness."
*   **Advanced AI Predictions:** An LSTM (Long Short-Term Memory) neural network, built with TensorFlow.js, is trained on the sequence of historical draws to predict the probability of each number appearing in the next draw.
*   **Intelligent Strategy Profiles:** Users can select from multiple generation strategies:
    *   **Balanced:** A mix of all statistical factors.
    *   **Aggressive:** Prioritizes "hot" and "overdue" numbers.
    *   **Conservative:** Strictly adheres to the most common statistical patterns.
    *   **Experimental:** Favors "cold" numbers and less common patterns.
*   **Full User Customization:** A dedicated "Custom" strategy panel allows users to set hard constraints, such as sum ranges, and to force the inclusion or exclusion of specific numbers.
*   **Interactive Data Visualization:** The "Statistical Analysis" dashboard uses Chart.js to provide rich, interactive charts for Number Frequencies, Sum Distribution, Odd/Even splits, and High/Low splits.
*   **Complete User Workflow:** Users can generate single or multiple sets, save their favorite combinations to `localStorage`, check them against the latest official results, and delete them individually or all at once.

---

## Tech Stack

*   **Frontend:**
    *   HTML5, CSS3, JavaScript (ES6+)
    *   **Chart.js:** For interactive data visualization.
    *   **TensorFlow.js:** For building and running the client-side ML model.
    *   **Web Workers:** To offload the intensive genetic algorithm calculations from the UI thread.
*   **Backend:**
    *   **Node.js:** JavaScript runtime environment.
    *   **Express.js:** Web server framework.
    *   **Axios:** For making HTTP requests to the Loto-Québec website.
    *   **Cheerio:** For parsing HTML and scraping web data.
    *   **CORS:** To handle cross-origin requests from the frontend.

---

## How to Run This Project

This is a full-stack application with a separate frontend and backend. You must run both servers simultaneously.

### Prerequisites

*   Node.js and npm installed on your machine.

### 1. Setup and Installation

In your terminal, navigate to the project's root directory and install the necessary backend dependencies:

```bash
npm install express cors axios cheerio