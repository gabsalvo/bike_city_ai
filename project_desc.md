The original "15-minute city" concept focuses on a walking radius (approx. 1.25 km), yet research
indicates that restricting travel to such a small area can increase experienced segregation for low-
income residents in the states as shown in [2]. In the Netherlands, where biking is a primary mode of
transport, a 10-minute biking radius (approx. 3 km) covers more ground, potentially offering the
environmental benefits of local living without the social isolation trap. Using CBS neighborhood data
[3] and ODiN mobility data [4], you will analyze how this expanded "active transport" radius impacts
accessibility, usage, and social diversity.
• Redefining the isochrone: Replace the paper's 5 km/h walking speed with a standard biking
speed (e.g., 18 km/h) to create a 3-kilometer "10-minute bike-shed".
• Mapping access vs. usage: Calculate "10-minute access", that is, the number of essential
amenities in the Netherlands, defined in [1] within 3 km, and "10-minute usage" (the percentage
of consumption trips made within that bike-shed).
Figure 1 by ChatGPT
• Evaluating social exposure: Determine if the expanded biking radius allows residents of low-
income neighborhoods to encounter more diverse socio-economic groups compared to a strictly
walkable radius.
Potential research questions (check the potential questions provided in [1] too)
1. The cycling access-usage correlation: To what extent does having essential amenities within a
10-minute bike ride (CBS data) predict actual trip behavior (ODiN data)? Does the high
correlation (84%) found in the US study for walking hold true for Dutch cycling patterns?
2. mitigating experienced segregation: The paper found that for low-income residents, longer trips
results in a 16.7% reduction in experienced segregation. Does a 10-minute biking radius provide
enough "geographic reach" to significantly reduce socio-economic isolation compared to a 15-
minute walk?
3. Mode competition: In neighborhoods where essential destinations (supermarkets, schools,
doctors) are within a 10-minute bike ride, do residents actually choose active transport, or is
there a persistent "regional divide" in car dependency similar to the US South?
4. Equity in biking access: How does 10-minute biking access to the seven "essential destination"
categories defined in the background document differ between the highest and lowest income
deciles in the Netherlands?
5. Additionally, adding one analysis that help policy makers to revise policies in the future. For
instance, a municipality wants to see which neighbourhood scores good/bad and what the sum
is of all scores, regions and provinces wants to know what the scores are per municipality, and on
a na^onal level the scores per province are required.
For certain questions, you are encouraged to go beyond aggregated analysis and adopt a fine-
grained perspective, for instance, distinguishing between different target groups (e.g., students,
working population, elderly), population groups (e.g., age, income, gender) and spatial contexts
(e.g., cities or regions).
Deliverables: Written chapter in the final report; code.
Topic 2: Predic6ve Modelling
Based on the analysis and insights you obtained from Topic 1, this phase asks you to build a
prediction model. You have three suggested options.
Option 1: Predicting "Active Mobility Usage"
Following the paper [2]’s core finding that amenity proximity is the strongest predictor of travel
behavior, you can build a regression model using ML models, e.g., DNN, Random Forest, Gradient
Boosting, to predict the percentage of local trips, where
• Target variable: 10-minute biking usage (from ODiN data).
• Features: example features are distances to the "essential" destinations (from CBS), population
density, and neighborhood income etc.
• Goal: Determine if the "Access-Usage" relationship found in the US (where access explains 74–
84% of usage) is equally predictable in the Dutch cycling context.
Option 2. Amenity gap analysis
The paper [2] notes that certain amenities, such as schools and grocery stores, are "integral parts of
daily life" and have a higher weight in determining local living.
- Task: Use clustering to group neighborhoods based on their "amenity profile" and then use
feature importance to see which specific amenities (e.g., healthcare vs. restaurants) are the
strongest drivers of biking behavior in different regions.
- Goal: Identify which missing amenity, if added to an "underserved" cluster, would provide the
largest predicted increase in local biking trips.
Option 3. Mode choice predicPon: Use ODiN datasets to build a model describing a person’s travel
mode choice (bike, e-bike, car, or public transpora^on PT) for different purposes like work, shopping,
or leisure. See [6,7] for example techniques.
Deliverables: Written chapter in the final report; code.
Topic 3: The urban equity dashboard: AI-powered interface
Finally, you will act as urban technology consultants and develop an interactive decision-support
interface for policymakers, translating the analytical results from previous stages into a practical urban
planning tool by integrating CBS and ODiN data with outputs from machine learning models developed
earlier in the project. The system should include an LLM-based AI agent that does not replace
predictive models but serves as an interactive explanation and policy-support layer. Through natural-
language interaction, it should help users interpret neighborhood patterns, compare intervention
scenarios, understand trade-offs, and generate concise planning recommendations.
Key Objectives
• Bridge the Data-Policy Gap: Transform complex regression and classification results into intuitive
visual markers.
• Simulate Urban Interventions: Enable policymaker to assess how interventions such as adding
amenities or improving accessibility may affect local mobility behavior and amenity gaps.
• Use an LLM agent to explain results & support planning decisions: Provide natural language
interaction that helps users interpret neighborhood patterns, compare intervention scenarios,
understand trade-offs, and generate concise policy-oriented recommendations.
Subtask 1: Interface Design and Spatial Synthesis
• Data Integration: you will use AI coding assistants to merge neighborhood-level access
indices (from CBS) with usage metrics (from ODiN), and the outputs of the regression and
classification models developed in earlier stages of the project.
• Feature 1: The Access-Usage Heatmap: The dashboard must show the 3-kilometer “10-minute
bike-shed” for any selected neighborhood. It should visualize the relationship between access and
usage, highlighting areas where local living is high (environmental success) and areas where good
access exists, but local usage remains low (policy opportunity).
• Feature 2: The Essential Function Audit: Users can toggle between the essential amenity
categories to examine which neighborhoods are well served and which remain underserved in
terms of 10-minute biking access.
Subtask 2: Scenario Evaluation & LLM Agent Supported Policy Guidance
• Feature 3: The "What-If" Scenario Builder: you should implement a scenario-based evaluation
function in the backend, such as adding a new school or grocery store, improving accessibility to
essential amenities, or changing the availability of selected functions. The system should generate
updated model outputs for each scenario, allowing users to assess predicted changes in local
biking trips, amenity gaps, and segregation-related risks.
• Feature 5: The AI-Agent Policy Assistant: The system should include an LLM-based AI agent that
supports natural-language interaction within the interface. The agent does not replace the
predictive models but acts as an explanation and policy-support layer. It should help users
interpret neighborhood patterns, explain model outputs, compare intervention scenarios’ results,
understand trade-offs, and generate concise planning recommendations.
Deliverables: Written chapter in the final report; A functional urban policy dashboard supported by
an LLM-based AI agent, where a policymaker can explore biking accessibility and mobility patterns,
compare intervention scenarios, and receive clear, data-grounded recommendations about the
environmental benefits of a 10-minute biking city strategy.
AI agent background and build:
• OpenAI – A prac^cal guide to building agents
• OpenAI Developers – Building agents
Gemini AI QuickStart, API documentaPon, funcPon calling, and examples:
• Google AI for Developers – Gemini API documenta^on
Example paper [8]:
• Kalyuzhnaya, Anna, et al. "LLM agents for smart city management: Enhancing decision
support through multi-agent AI systems." Smart Cities 8.1 (2025): 19.
https://doi.org/10.3390/smartcities8010019
References
[1] “Problem overview SmartwayZ.pdf”, available at Canvas
[2] Abbiasov, Timur, et al. "The 15-minute city quan^fied using human mobility data." Nature Human
Behaviour 8.3 (2024): 445-455.
hops://re.public.polimi.it/bitstream/11311/1300136/1/20240205_Abbiasov-etal_15-
minuteCity_NatureHB.pdf
[3] CBS neighborhood data: hops://www.cbs.nl/nl-nl/maatwerk/2025/40/kerncijfers-wijken-en-
buurten-2025; and the explana^on of data: Toelich^ng variabelen kerncijfers wijken en buurten 2025
[4] Onderzoek Onderweg in Nederland (ODiN): hops://www.cbs.nl/nl-
nl/longread/rapportages/2025/onderweg-in-nederland--odin---2024-onderzoeksbeschrijving/2-
onderweg-in-nederland--odin--
[5] Basic Register of Addresses and Buildings (BAG): hops://www.digitaleoverheid.nl/overzicht-van-
alle-onderwerpen/stelsel-van-basisregistra^es/10-basisregistra^es/bag/
[6] Kashifi, Mohammad Tamim, et al. "Predic^ng the travel mode choice with interpretable machine
learning techniques: A compara^ve study." Travel Behaviour and Society 29 (2022): 279-296.
hops://doi.org/10.1016/j.tbs.2022.07.003
[7] Wang, Shenhao, et al. "Comparing hundreds of machine learning and discrete choice models for
travel demand modeling: An empirical benchmark." Transporta^on Research Part B: Methodological
190 (2024): 103061. hops://doi.org/10.1016/j.trb.2024.103061
[8] Kalyuzhnaya, Anna, et al. "LLM agents for smart city management: Enhancing decision support
through multi-agent AI systems." Smart Cities 8.1 (2025): 19.
https://doi.org/10.3390/smartcities8010