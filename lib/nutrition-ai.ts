import {z} from "zod";
import type {NutritionContent,Meal} from "./nutrition";

export const goalOptions={fat_loss:"Απώλεια λίπους",muscle_gain:"Αύξηση μυϊκής μάζας",lean_bulk:"Καθαρός όγκος",definition:"Γράμμωση",maintenance:"Συντήρηση βάρους",recomposition:"Body recomposition",performance:"Βελτίωση αθλητικής απόδοσης"} as const;
export const trainingOptions=["EMS","Βάρη","Cross Training","Boxing/Kick Boxing","Cardio","EMS + Βάρη","Άλλο"] as const;
export const activityOptions={sedentary:"Καθιστική",light:"Ελαφριά",moderate:"Μέτρια",high:"Υψηλή",athlete:"Αθλητής/τρια"} as const;
export const budgetOptions={economy:"Οικονομικό",standard:"Κανονικό",premium:"Premium"} as const;

export const nutritionIntakeSchema=z.object({
  memberId:z.string().uuid(),name:z.string().trim().min(2).max(160),sex:z.enum(["male","female","other"]),age:z.number().int().min(14).max(100),heightCm:z.number().min(100).max(240),weightKg:z.number().min(30).max(350),
  bodyFatPercent:z.number().min(2).max(70).nullable(),muscleMassKg:z.number().min(0).max(250).nullable(),visceralFat:z.number().min(0).max(100).nullable(),metabolicAge:z.number().int().min(1).max(130).nullable(),bmrKcal:z.number().int().min(500).max(6000).nullable(),
  goal:z.enum(Object.keys(goalOptions) as [keyof typeof goalOptions,...(keyof typeof goalOptions)[]]),activity:z.enum(Object.keys(activityOptions) as [keyof typeof activityOptions,...(keyof typeof activityOptions)[]]),training:z.enum(trainingOptions),trainingDays:z.number().int().min(0).max(14),
  allergies:z.string().max(2000),excludedFoods:z.string().max(2000),preferredFoods:z.string().max(2000),medicalNotes:z.string().max(3000),mealsPerDay:z.number().int().min(2).max(8),mealTimes:z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(2).max(8),budget:z.enum(Object.keys(budgetOptions) as [keyof typeof budgetOptions,...(keyof typeof budgetOptions)[]]),measuredOn:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).superRefine((value,ctx)=>{if(value.mealTimes.length!==value.mealsPerDay)ctx.addIssue({code:"custom",path:["mealTimes"],message:"Οι ώρες πρέπει να είναι όσες και τα γεύματα."})});
export type NutritionIntake=z.infer<typeof nutritionIntakeSchema>;

export const nutritionRulesSchema=z.object({
  activityMultipliers:z.record(z.string(),z.number().min(1).max(3)),goalAdjustments:z.record(z.string(),z.number().min(-.5).max(.5)),proteinPerKg:z.record(z.string(),z.number().min(.5).max(4)),fatPerKg:z.number().min(.3).max(2),minimumCaloriesFemale:z.number().int().min(800).max(3000),minimumCaloriesMale:z.number().int().min(900).max(3500),targetTolerancePercent:z.number().min(1).max(20),maxGenerationsPerDay:z.number().int().min(1).max(100)
});
export type NutritionRules=z.infer<typeof nutritionRulesSchema>;
export const defaultNutritionRules:NutritionRules={activityMultipliers:{sedentary:1.2,light:1.375,moderate:1.55,high:1.725,athlete:1.9},goalAdjustments:{fat_loss:-.18,muscle_gain:.1,lean_bulk:.08,definition:-.12,maintenance:0,recomposition:-.05,performance:.05},proteinPerKg:{fat_loss:2,muscle_gain:2,lean_bulk:1.9,definition:2.2,maintenance:1.7,recomposition:2.1,performance:1.8},fatPerKg:.8,minimumCaloriesFemale:1200,minimumCaloriesMale:1500,targetTolerancePercent:5,maxGenerationsPerDay:20};

export type NutritionTargets={bmr:number;tdee:number;calories:number;protein:number;carbs:number;fat:number;formula:string};
const round=(n:number)=>Math.round(n);
export function calculateNutritionTargets(input:NutritionIntake,rules:NutritionRules):NutritionTargets{
  let bmr=input.bmrKcal||0,formula=input.bmrKcal?"Καταχωρημένο BMR":"Mifflin-St Jeor";
  if(!bmr&&input.bodyFatPercent!=null){const lean=input.weightKg*(1-input.bodyFatPercent/100);bmr=370+21.6*lean;formula="Katch-McArdle"}
  if(!bmr){const sexOffset=input.sex==="male"?5:input.sex==="female"?-161:-78;bmr=10*input.weightKg+6.25*input.heightCm-5*input.age+sexOffset}
  const tdee=bmr*(rules.activityMultipliers[input.activity]??1.55);
  const raw=tdee*(1+(rules.goalAdjustments[input.goal]??0));
  const minimum=input.sex==="male"?rules.minimumCaloriesMale:rules.minimumCaloriesFemale;
  const calories=Math.max(minimum,round(raw));
  const protein=round(input.weightKg*(rules.proteinPerKg[input.goal]??1.8));
  let fat=round(input.weightKg*rules.fatPerKg);
  let carbs=round((calories-protein*4-fat*9)/4);
  if(carbs<50){carbs=50;fat=Math.max(30,round((calories-protein*4-carbs*4)/9))}
  return {bmr:round(bmr),tdee:round(tdee),calories,protein,carbs,fat,formula};
}

const foodItem=z.object({food:z.string().min(1).max(180),grams:z.number().min(0).max(3000),note:z.string().max(240)});
const alternative=z.object({label:z.string().min(1).max(240),items:z.array(foodItem).min(1).max(8)});
const generatedMeal=z.object({name:z.string().min(1).max(120),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),timing:z.enum(["regular","pre_workout","post_workout"]),items:z.array(foodItem).min(1).max(12),alternatives:z.array(alternative).max(3),kcal:z.number().min(0).max(5000),protein:z.number().min(0).max(500),carbs:z.number().min(0).max(1000),fat:z.number().min(0).max(500)});
const generatedDay=z.object({day:z.enum(["Δευτέρα","Τρίτη","Τετάρτη","Πέμπτη","Παρασκευή","Σάββατο","Κυριακή"]),trainingNote:z.string().max(300),meals:z.array(generatedMeal).min(2).max(8),totalKcal:z.number().min(0),totalProtein:z.number().min(0),totalCarbs:z.number().min(0),totalFat:z.number().min(0)});
export const generatedNutritionPlanSchema=z.object({title:z.string().min(3).max(160),summary:z.string().min(20).max(1200),targetCalories:z.number().min(800).max(8000),targetProtein:z.number().min(20).max(800),targetCarbs:z.number().min(20).max(1500),targetFat:z.number().min(15).max(500),days:z.array(generatedDay).length(7),shoppingList:z.array(z.object({category:z.string().min(1).max(80),items:z.array(z.object({name:z.string().min(1).max(180),quantity:z.string().min(1).max(100)})).min(1).max(40)})).min(1).max(12),hydration:z.string().min(1).max(500),coachNotes:z.array(z.string().min(1).max(400)).max(10)});
export type GeneratedNutritionPlan=z.infer<typeof generatedNutritionPlanSchema>;

export function generatedPlanToContent(plan:GeneratedNutritionPlan,intake:NutritionIntake,targets:NutritionTargets):NutritionContent{
  const days=plan.days.map(day=>day.meals.map(meal=>({
    name:`${meal.name}${meal.timing==="pre_workout"?" · Pre-workout":meal.timing==="post_workout"?" · Post-workout":""}`,
    time:meal.time,
    food:meal.items.map(item=>`${item.food}${item.note?` (${item.note})`:""}`).join("\n"),
    quantity:meal.items.map(item=>`${item.grams} g`).join("\n"),
    alternative:meal.alternatives.map(a=>`${a.label}: ${a.items.map(i=>`${i.food} ${i.grams} g`).join(", ")}`).join("\n"),
    kcal:String(round(meal.kcal)),protein:String(round(meal.protein)),carbs:String(round(meal.carbs)),fat:String(round(meal.fat))
  } satisfies Meal)));
  return {goal:goalOptions[intake.goal],preferences:[intake.allergies&&`Αλλεργίες/δυσανεξίες: ${intake.allergies}`,intake.excludedFoods&&`Δεν τρώει: ${intake.excludedFoods}`,intake.preferredFoods&&`Προτιμά: ${intake.preferredFoods}`].filter(Boolean).join("\n"),notes:`${plan.summary}\n\nΕνυδάτωση: ${plan.hydration}\n${plan.coachNotes.join("\n")}`,days,aiPlan:plan,aiIntake:intake,aiTargets:targets,shoppingList:plan.shoppingList};
}
