import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('shared/data/lapidary-health/health.json');

const markers = [
  { code:'HGB', name:'Hemoglobin', panel:'CBC', value:13.6, unit:'g/dL', refLow:12.1, refHigh:15.1, refDisplay:'12.1 - 15.1 g/dL', flag:'OPTIMAL', severity:'normal', anatomy:'system-vascular-marrow', views:['front','side'], trend:'STABLE', interpretation:'Within female reference range' },
  { code:'WBC', name:'White Blood Cells', panel:'CBC', value:6.4, unit:'10^3/uL', refLow:4.5, refHigh:11.0, refDisplay:'4.5 - 11.0 10^3/uL', flag:'OPTIMAL', severity:'normal', anatomy:'system-vascular-marrow', views:['front','side'], trend:'STABLE', interpretation:'No leukocytosis signal' },
  { code:'RBC', name:'Red Blood Cells', panel:'CBC', value:4.65, unit:'10^6/uL', refLow:4.2, refHigh:5.4, refDisplay:'4.2 - 5.4 10^6/uL', flag:'OPTIMAL', severity:'normal', anatomy:'system-vascular-marrow', views:['front','side'], trend:'STABLE', interpretation:'Within reference range' },
  { code:'PLT', name:'Platelet Count', panel:'CBC', value:262, unit:'10^3/uL', refLow:150, refHigh:400, refDisplay:'150 - 400 10^3/uL', flag:'OPTIMAL', severity:'normal', anatomy:'system-vascular-marrow', views:['front','side'], trend:'STABLE', interpretation:'Clotting profile nominal' },
  { code:'HCT', name:'Hematocrit', panel:'CBC', value:40.2, unit:'%', refLow:36.1, refHigh:44.3, refDisplay:'36.1 - 44.3 %', flag:'OPTIMAL', severity:'normal', anatomy:'system-vascular-marrow', views:['front','side'], trend:'STABLE', interpretation:'Within reference range' },
  { code:'FBG', name:'Fasting Blood Glucose', panel:'Metabolic', value:132, unit:'mg/dL', refLow:70, refHigh:99, refDisplay:'70 - 99 mg/dL', flag:'HIGH', severity:'high', anatomy:'organ-pancreas', views:['front'], trend:'RISING', interpretation:'Above reference range' },
  { code:'HBA1C', name:'HbA1c (90-Day Avg)', panel:'Metabolic', value:7.2, unit:'%', refLow:4.0, refHigh:5.6, refDisplay:'4.0 - 5.6 %', flag:'HIGH', severity:'high', anatomy:'organ-pancreas', views:['front'], trend:'RISING', interpretation:'Diabetes-range average' },
  { code:'CHOL', name:'Total Cholesterol', panel:'Lipid', value:220, unit:'mg/dL', refLow:125, refHigh:200, refDisplay:'125 - 200 mg/dL', flag:'BORDERLINE_HIGH', severity:'borderline', anatomy:'organ-heart', views:['front','side'], trend:'RISING', interpretation:'Borderline high' },
  { code:'LDL', name:'LDL Cholesterol', panel:'Lipid', value:168, unit:'mg/dL', refLow:0, refHigh:100, refDisplay:'< 100 mg/dL', flag:'HIGH', severity:'high', anatomy:'organ-heart', views:['front','side'], trend:'RISING', interpretation:'Above upper threshold', featured:true },
  { code:'HDL', name:'HDL Cholesterol', panel:'Lipid', value:62, unit:'mg/dL', refLow:50, refHigh:100, refDisplay:'> 50 mg/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-heart', views:['front'], trend:'STABLE', interpretation:'Protective range' },
  { code:'TRIG', name:'Triglycerides', panel:'Lipid', value:98, unit:'mg/dL', refLow:0, refHigh:150, refDisplay:'< 150 mg/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-heart', views:['front'], trend:'STABLE', interpretation:'Within reference range' },
  { code:'ALT', name:'ALT (SGPT)', panel:'LFT', value:78, unit:'U/L', refLow:7, refHigh:36, refDisplay:'7 - 36 U/L', flag:'HIGH', severity:'high', anatomy:'organ-liver', views:['front','side'], trend:'RISING', interpretation:'Hepatic enzyme elevated' },
  { code:'AST', name:'AST (SGOT)', panel:'LFT', value:19, unit:'U/L', refLow:8, refHigh:33, refDisplay:'8 - 33 U/L', flag:'OPTIMAL', severity:'normal', anatomy:'organ-liver', views:['front'], trend:'STABLE', interpretation:'Hepatic enzyme nominal' },
  { code:'ALP', name:'Alkaline Phosphatase', panel:'LFT', value:68, unit:'U/L', refLow:44, refHigh:147, refDisplay:'44 - 147 U/L', flag:'OPTIMAL', severity:'normal', anatomy:'organ-liver', views:['front'], trend:'STABLE', interpretation:'Biliary marker nominal' },
  { code:'TBIL', name:'Total Bilirubin', panel:'LFT', value:0.7, unit:'mg/dL', refLow:0.1, refHigh:1.2, refDisplay:'0.1 - 1.2 mg/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-liver', views:['front'], trend:'STABLE', interpretation:'Within reference range' },
  { code:'ALB', name:'Serum Albumin', panel:'LFT', value:4.4, unit:'g/dL', refLow:3.5, refHigh:5.0, refDisplay:'3.5 - 5.0 g/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-liver', views:['front'], trend:'STABLE', interpretation:'Synthetic liver function nominal' },
  { code:'CREA', name:'Serum Creatinine', panel:'KFT', value:0.81, unit:'mg/dL', refLow:0.5, refHigh:0.95, refDisplay:'0.5 - 0.95 mg/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-kidneys', views:['side'], trend:'STABLE', interpretation:'Within female reference range' },
  { code:'BUN', name:'Blood Urea Nitrogen', panel:'KFT', value:13, unit:'mg/dL', refLow:6, refHigh:20, refDisplay:'6 - 20 mg/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-kidneys', views:['side'], trend:'STABLE', interpretation:'Renal waste clearance nominal' },
  { code:'EGFR', name:'eGFR Filtration', panel:'KFT', value:104, unit:'mL/min', refLow:90, refHigh:120, refDisplay:'90 - 120 mL/min', flag:'OPTIMAL', severity:'normal', anatomy:'organ-kidneys', views:['side'], trend:'STABLE', interpretation:'Filtration nominal' },
  { code:'URIC', name:'Uric Acid', panel:'KFT', value:4.6, unit:'mg/dL', refLow:2.4, refHigh:6.0, refDisplay:'2.4 - 6.0 mg/dL', flag:'OPTIMAL', severity:'normal', anatomy:'organ-kidneys', views:['side'], trend:'STABLE', interpretation:'Within reference range' },
  { code:'NA_K', name:'Sodium / Potassium', panel:'KFT', value:'141 / 4.2', unit:'mmol/L', refLow:null, refHigh:null, refDisplay:'135 - 145 / 3.5 - 5.0 mmol/L', flag:'OPTIMAL', severity:'normal', anatomy:'organ-kidneys', views:['side'], trend:'STABLE', interpretation:'Electrolyte balance nominal' },
  { code:'TSH', name:'Thyroid Stimulating Hormone', panel:'Thyroid', value:1.85, unit:'mIU/L', refLow:0.4, refHigh:4.0, refDisplay:'0.4 - 4.0 mIU/L', flag:'OPTIMAL', severity:'normal', anatomy:'organ-thyroid', views:['front'], trend:'STABLE', interpretation:'Thyroid axis nominal' },
  { code:'VITD', name:'Vitamin D (25-OH)', panel:'Vitamins', value:18, unit:'ng/mL', refLow:30, refHigh:100, refDisplay:'30 - 100 ng/mL', flag:'LOW', severity:'low', anatomy:'system-nutrition', views:['front','side'], trend:'FALLING', interpretation:'Below reference range', featured:true },
  { code:'B12', name:'Vitamin B12', panel:'Vitamins', value:310, unit:'pg/mL', refLow:200, refHigh:900, refDisplay:'200 - 900 pg/mL', flag:'OPTIMAL', severity:'normal', anatomy:'system-nutrition', views:['front','side'], trend:'STABLE', interpretation:'Within reference range' },
  { code:'FERR', name:'Serum Ferritin', panel:'Vitamins', value:12.0, unit:'ng/mL', refLow:15, refHigh:150, refDisplay:'15 - 150 ng/mL', flag:'LOW', severity:'low', anatomy:'system-vascular-marrow', views:['front','side'], trend:'FALLING', interpretation:'Low iron store', featured:true }
];

const patient = {
  id:'PT-8841-V', name:'ELENA ROSTOVA', age:34, sex:'F', bloodType:'O+', bmi:22.1, diagnosis:'TYPE 2 DIABETES', riskIndex:0.82
};
const vitals = { hr:88, bp:'148/96', spo2:96, temp:36.9, bmi:22.1 };
const ecg = { bpm:88, spo2:96, rhythm:'SINUS / ELEVATED' };
const urinalysis = { protein:'NEG', glucose:'NEG', ph:6.0, specificGravity:1.015 };
const panelDate = '2026-11-11';
const facility = 'BIO-DIAGNOSTIC BAY 04 / PREVENTIVE LAB';
const attending = 'DR. K. OLAWALE';

const summary = {
  total: markers.length,
  optimal: markers.filter(m => m.severity === 'normal').length,
  flagged: markers.filter(m => m.severity !== 'normal').length
};

const severityRank = { normal:0, borderline:1, low:2, high:3 };
const organLabels = {
  'organ-heart':'CARDIOVASCULAR',
  'organ-liver':'HEPATIC',
  'organ-kidneys':'RENAL',
  'organ-thyroid':'THYROID',
  'organ-pancreas':'PANCREATIC',
  'system-vascular-marrow':'HEMATOLOGY / MARROW',
  'system-nutrition':'NUTRITIONAL',
  'organ-bladder':'URINARY'
};
const organs = [];
for (const [id, label] of Object.entries(organLabels)) {
  const rows = markers.filter(m => m.anatomy === id);
  if (!rows.length) continue;
  const worst = rows.reduce((a,b) => severityRank[b.severity] > severityRank[a.severity] ? b : a, rows[0]);
  organs.push({
    id, label,
    state: worst.severity,
    flag: worst.flag,
    trigger: worst.code,
    value: `${worst.value} ${worst.unit}`,
    reference: worst.refDisplay,
    markers: rows.map(m => m.code)
  });
}

const coverage = [
  { system:'CBC', tested:5, total:5, state:'normal' },
  { system:'LFT', tested:5, total:5, state:'high' },
  { system:'KFT', tested:5, total:5, state:'normal' },
  { system:'METABOLIC', tested:2, total:2, state:'high' },
  { system:'LIPID', tested:4, total:4, state:'high' },
  { system:'THYROID', tested:1, total:1, state:'normal' },
  { system:'VITAMINS', tested:3, total:3, state:'low' },
  { system:'URINALYSIS', tested:1, total:1, state:'normal' }
];

const trends = [
  { code:'TSH', label:'TSH', unit:'mIU/L', values:[1.7,1.8,1.9,1.85], refLow:0.4, refHigh:4.0, state:'normal', trend:'STABLE' },
  { code:'VITD', label:'VIT D', unit:'ng/mL', values:[26,24,21,18], refLow:30, refHigh:100, state:'low', trend:'FALLING' },
  { code:'B12', label:'B12', unit:'pg/mL', values:[330,320,315,310], refLow:200, refHigh:900, state:'normal', trend:'STABLE' },
  { code:'FERR', label:'FERRITIN', unit:'ng/mL', values:[18,16,14,12], refLow:15, refHigh:150, state:'low', trend:'FALLING' }
];

const tasks = [
  { id:'t1', label:'Repeat lipid + HbA1c', detail:'LDL 168 / HbA1c 7.2', due:'90 D', state:'queued' },
  { id:'t2', label:'Vitamin D recheck', detail:'18 ng/mL / low', due:'90 D', state:'queued' },
  { id:'t3', label:'Ferritin + liver review', detail:'Ferritin 12 / ALT 78', due:'30 D', state:'active' },
  { id:'t4', label:'Diabetes care review', detail:'Type 2 diabetes / metabolic risk', due:'14 D', state:'active' }
];

const summaryCards = [
  { kind:'patient', title:'PATIENT', code:'PT', value:patient.name, meta:`${patient.age}${patient.sex} / ${patient.bloodType}`, lines:[`ID ${patient.id}`, `PANEL ${panelDate}`] },
  { kind:'vitals', title:'VITALS', code:'VIT', value:`${vitals.bp} mmHg`, meta:`HR ${vitals.hr} / SpO2 ${vitals.spo2}%`, lines:[`TEMP ${vitals.temp} C`, `BMI ${vitals.bmi}`] },
  { kind:'risk', title:'METABOLIC RISK', code:'RISK', value:'HIGH', meta:'DEMO INDEX 0.82', lines:['DX TYPE 2 DIABETES', 'FBG 132 / HbA1c 7.2', 'LDL 168 / ALT 78'] },
  { kind:'coverage', title:'PANEL COVERAGE', code:'COV', value:'25 / 25', meta:'8 SYSTEMS', lines:['18 optimal / 7 flagged', 'Urinalysis included'] },
  { kind:'urinalysis', title:'URINALYSIS', code:'UA', value:'NEG / NEG', meta:'PROTEIN / GLUCOSE', lines:[`pH ${urinalysis.ph}`, `SG ${urinalysis.specificGravity}`] },
  { kind:'legend', title:'FLAG LEGEND', code:'KEY', value:'CLINICAL', meta:'MOCK DATA', lines:['LOW / BORDERLINE / HIGH', 'Not medical advice'] }
];

const data = {
  meta: {
    slug:'lapidary-health',
    generated:new Date().toISOString(),
    disclaimer:'Mock data for interface demonstration only. Not medical advice or a diagnostic device.'
  },
  facility, attending, panelDate,
  patient, vitals, urinalysis, ecg,
  summary, markers, summaryCards, organs, coverage, trends, tasks
};

fs.mkdirSync(path.dirname(OUT), { recursive:true });
fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`wrote ${OUT} (${markers.length} markers, ${summary.optimal} optimal, ${summary.flagged} flagged)`);
