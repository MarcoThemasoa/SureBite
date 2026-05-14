# SureBite System Architecture & Technical Report

## 1. Technology Stack Overview

**Frontend**
*   **Framework**: React 18 with Vite (TypeScript)
*   **Styling**: Tailwind CSS
*   **Icons**: Lucide React
*   **Typography & Components**: Custom HTML/CSS with modular React Components
*   **Markdown Parsing**: `react-markdown` for parsing Chatbot responses

**Backend & Infrastructure (BaaS)**
*   **Service Platform**: Supabase
*   **Database**: PostgreSQL
*   **Authentication**: Supabase Auth (Email & Password)
*   **Hosting**: Capable of standard static hosting (Vercel, Netlify, Firebase Hosting)

**Artificial Intelligence**
*   **Model Provider**: Google Gemini (`@google/genai` SDK)
*   **Model Tier**: Gemini Flash Preview for fast, efficient text and image analysis.
*   **Caching Strategy**: In-memory caching `Map` on API inputs to heavily mitigate redundant requests and save token costs.

---

## 2. Core Logical Architecture & App Flow

### Data & State Management
The application relies on a unilateral data flow. State is managed locally via React hooks (`useState`, `useMemo`), but all permanent states are synced to a Supabase database instance.

1.  **Authentication Layer**: App initializes by probing Supabase for an active session. If unauthenticated, the user is locked to `auth` and `tos` views.
2.  **Profile Initialization**: On login, the `profiles` table is queried. If the profile lacks data, the user is forwarded to the onboarding pipeline (Age, Clinical Allergies, Safe Meals).
3.  **Local Context (`profile` state)**: The profile state acts as the "BrainContext" for the entire application. It contains:
    *   `allergies`: Hard clinical limitations.
    *   `baseIngredients`: Default safe plates.
    *   `ingredientOverrides`: User-defined status changes (e.g., forcing an ingredient from Yellow to Green).
    *   `allergenSideEffects`: Qualitative notes linked specifically to "Danger Zone" ingredients.
    *   `history`: Array of past scans acting as the user's historical safety net.

### The AI Synthesis Factory (Gemini)
Gemini handles three core systems:
1.  **Text Analysis**: taking unstructured text inputs and structuring them into a strict rubric (Red/Yellow/Blue/Green + Evidence).
2.  **Vision Analysis**: analyzing product packaging or raw meal photos, transcribing the data, and processing it against the context.
3.  **SureChat**: a persistent RAG (Retrieval-Augmented Generation) Chat flow. It securely passes the entire local `profile` state as system instructions so it knows the user's allergies, safe plates, history, and reactions without the user needing to repeat themselves.

### Efficient Caching Execution
To lower latency and prevent hitting rate limits during sessions, API calls utilize a rudimentary closure-level cache (`cacheKey` maps). Text queries are hashed alongside the user context, fetching instantly on repeated evaluations. `useMemo` is deployed on heavy calculations (like aggregating the massive `Danger Zone` lists) to prevent UI stutter during React renders.

---

## 3. Database Schema Mapping (Supabase)

The core table utilized is `profiles`:

*   **id** `uuid` (Primary Key, explicit to `auth.users.id`)
*   **updated_at** `timestamp`
*   **age** `text`
*   **allergies** `jsonb` (Array of clinical strings)
*   **base_ingredients** `jsonb` (Array of safe plate strings)
*   **history** `jsonb` (Log of all historical scan objects)
*   **ingredient_overrides** `jsonb` (Key-value map of { ingredient: string })
*   **allergen_side_effects** `jsonb` (Key-value map of { ingredient: string[] })

Whenever local state diverges via user interaction, `syncProfileToSupabase` pushes a unified `upsert` block.

---

## 4. UI/UX Paradigm ("Zero-Budget Stack")
The philosophy is highly utilitarian and high-contrast, opting for a clean brutalist UI. It focuses on accessibility over visual clutter:
*   High contrast typography (Serif for headers, Sans/Mono for data).
*   Rigid bottom navigation ensuring mobile thumb accessibility.
*   "Traffic Light" status badges strictly regulating ingredient safety (Red=Allergen, Yellow=Sensitivity, Blue=Novel/Unknown, Green=Safe).

---

## 5. Security & Constraints
*   Supabase automatically employs Row Level Security (RLS). Ensure your rules are set so `auth.uid() = id`.
*   Gemini Prompts are strictly confined with negative prompts ("Act like it's naturally accessible to you", "Use this strict rubric").
