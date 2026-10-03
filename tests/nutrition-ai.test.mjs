import test from "node:test";
import assert from "node:assert/strict";
import {calculateNutritionTargets,defaultNutritionRules,generatedNutritionPlanSchema,nutritionIntakeSchema} from "../lib/nutrition-ai.ts";

const intake=nutritionIntakeSchema.parse({memberId:"00000000-0000-4000-8000-000000000001",name:"Δοκιμή",sex:"male",age:30,heightCm:180,weightKg:80,bodyFatPercent:20,muscleMassKg:40,visceralFat:8,metabolicAge:31,bmrKcal:null,goal:"fat_loss",activity:"moderate",training:"EMS",trainingDays:3,allergies:"",excludedFoods:"",preferredFoods:"ρύζι",medicalNotes:"",mealsPerDay:4,mealTimes:["08:00","12:30","17:00","21:00"],budget:"standard",measuredOn:"2026-10-03"});

test("calculates targets from measurements and configurable rules",()=>{
  const targets=calculateNutritionTargets(intake,defaultNutritionRules);
  assert.equal(targets.formula,"Katch-McArdle");
  assert.equal(targets.bmr,1752);
  assert.equal(targets.calories,2227);
  assert.equal(targets.protein,160);
  assert.ok(targets.carbs>0&&targets.fat>0);
  const custom=calculateNutritionTargets(intake,{...defaultNutritionRules,goalAdjustments:{...defaultNutritionRules.goalAdjustments,fat_loss:-.1},proteinPerKg:{...defaultNutritionRules.proteinPerKg,fat_loss:2.4}});
  assert.ok(custom.calories>targets.calories);
  assert.equal(custom.protein,192);
});

test("rejects incomplete structured AI output",()=>{
  const result=generatedNutritionPlanSchema.safeParse({title:"x",days:[]});
  assert.equal(result.success,false);
});
